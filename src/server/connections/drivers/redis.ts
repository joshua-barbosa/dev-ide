// Redis: chaves numa árvore, comandos numa grade.
//
// A parte que erra — agrupar chaves por prefixo, ler a URL, decidir a trava de
// somente-leitura, achatar a resposta na grade — mora em
// `shared/sql/redis-modelo.ts` e é testada sem servidor nenhum. Aqui fica só o
// que precisa falar com o Redis de verdade.
//
// **A navegação usa `SCAN`, e nunca `KEYS`.** O `KEYS *` percorre o espaço de
// chaves inteiro num passo só e BLOQUEIA o servidor enquanto faz isso — num
// Redis de produção com milhões de chaves, abrir a árvore derrubaria a
// aplicação de alguém. O `SCAN` devolve aos poucos e deixa o servidor
// respirando entre um lote e outro.
import Redis from 'ioredis';
import type { Driver, ResolvedConfig, Session, TreeNode } from '../types';
import type { ExecuteRequest, FieldSpec, QueryResult } from '../../../shared/contracts';
import {
  destinoDaConexao, lerComando, linhasDaResposta, modoDeConexao,
  abrirCampoJson, acumularRamos, lerRespostaDeBusca,
  podeRodarSomenteLeituraComModulos, ramosDoAcumulado,
  type AcumuladoDeRamos,
} from '../../../shared/sql/redis-modelo';
import {
  bancoDoRotulo, bancosVisiveis, lerKeyspace, lerListaDeBancos, lerQuantosBancos,
  QUANTOS_BANCOS_PADRAO, type BancoDoRedis,
} from '../../../shared/sql/redis-bancos';
import { SECAO_DA_ARVORE } from '../../../shared/sql/categorias-visiveis';
import { CLI_REDIS } from '../../../shared/terminal/clientes/redis';
import {
  apagarChave, estadoDoServidor, gravarChave, lerChave,
} from './redis-chaves';
import { colunasDaAmostra, linhasDosDocumentos } from '../../../shared/sql/mongo-modelo';

export const PORTA_PADRAO = 6379;

/**
 * Quanto tempo uma abertura de nó pode levar antes de mostrar o que já tem.
 *
 * **Não há teto de CHAVES.** A primeira versão parava em 5 000 e truncava a
 * árvore — ele tem muitas chaves, e a árvore mentia sem dizer. Agora o limite é
 * de TEMPO: a varredura vai até o fim, e se demorar mais que isto ela devolve o
 * que contou e guarda o cursor para continuar.
 *
 * A memória não é o problema: só o CONTADOR por segmento é guardado, e ele tem o
 * tamanho do número de nomes distintos — dezenas, não milhões.
 */
const ORCAMENTO_MS = 4_000;

/** Quantas chaves o servidor tenta devolver por rodada de `SCAN`. */
const POR_RODADA = 1_000;

const CAMPOS: readonly FieldSpec[] = [
  {
    name: 'modo',
    label: 'Como conectar',
    type: 'select',
    default: 'campos',
    options: [
      { value: 'campos', label: 'Host, porta, usuário e senha' },
      { value: 'url', label: 'URL (redis:// ou rediss://)' },
    ],
    help: 'A URL é o que se copia de um painel de nuvem; os campos, o que se digita de cabeça.',
  },
  {
    name: 'url',
    label: 'URL',
    type: 'string',
    placeholder: 'redis://:senha@servidor:6379/0',
    showIf: { campo: 'modo', valores: ['url'] },
    secret: true,
    help: 'Vai para o cofre cifrada: ela carrega a senha dentro.',
  },
  { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1',
    showIf: { campo: 'modo', valores: ['campos'] } },
  { name: 'port', label: 'Porta', type: 'number', default: PORTA_PADRAO,
    showIf: { campo: 'modo', valores: ['campos'] } },
  {
    name: 'username',
    label: 'Usuário',
    type: 'string',
    showIf: { campo: 'modo', valores: ['campos'] },
    help: 'Deixe VAZIO quando o servidor tem só senha (requirepass). A IDE não inventa um.',
  },
  { name: 'password', label: 'Senha', type: 'string', secret: true,
    showIf: { campo: 'modo', valores: ['campos'] } },
  { name: 'database', label: 'Banco', type: 'number', default: 0,
    showIf: { campo: 'modo', valores: ['campos'] } },
  {
    name: 'tls',
    // "SSL" no rótulo porque é o nome que aparece nos painéis de nuvem e o que
    // ele usou ao pedir (03/09/2026) — TLS é o nome certo, SSL é o procurado.
    label: 'Usar TLS (SSL)',
    type: 'boolean',
    default: false,
    help: 'Soma com o esquema: `rediss://` já é TLS, e desmarcar aqui não o desliga.',
  },
  {
    name: 'todos_bancos',
    label: 'Mostrar todos os bancos',
    type: 'boolean',
    default: false,
    section: SECAO_DA_ARVORE,
    help:
      'Um servidor Redis tem 16 bancos numerados. Desligado, a árvore mostra só ' +
      'o banco desta conexão — que é como sempre foi.',
  },
  {
    name: 'bancos_visiveis',
    label: 'Bancos visíveis',
    type: 'string',
    placeholder: 'ex.: 0, 3, db7',
    section: SECAO_DA_ARVORE,
    showIf: { campo: 'todos_bancos', valores: ['true'] },
    help: 'Lista branca. Vazio mostra todos os que o servidor tiver.',
  },
  {
    name: 'modulos',
    label: 'Usar RedisJSON e RediSearch',
    type: 'boolean',
    default: true,
    section: SECAO_DA_ARVORE,
    help:
      'Ligado, a IDE procura índices do RediSearch e abre campo JSON na grade. ' +
      'Desligue para ver o servidor como Redis puro — e para poupar a consulta ' +
      'de índices em quem não tem os módulos.',
  },
  {
    name: 'standalone',
    label: 'Forçar conexão standalone',
    type: 'boolean',
    default: false,
    help:
      'Falar só com este servidor, sem procurar cluster. Ligue quando o endereço ' +
      'for um túnel, um balanceador ou um proxy: os nós que o cluster anuncia têm ' +
      'IPs internos que esta máquina não alcança.',
  },
];

const SERVER_ID = '@servidor';
const CATEGORIA_INDICES = '@indices';
const CATEGORIA_CHAVES = '@chaves';

/**
 * Os índices do RediSearch, ou vazio quando o módulo não está instalado.
 *
 * `FT._LIST` não existe num Redis sem o módulo, e o erro é "unknown command".
 * Isso NÃO é falha: é um Redis comum, e a categoria simplesmente não nasce.
 */
async function listarIndices(cliente: Redis, usarModulos: boolean): Promise<string[]> {
  // Interruptor do cadastro: desligado, nem se pergunta. Poupa uma ida ao
  // servidor em quem não tem os módulos, e é o que faz "ver como Redis puro"
  // significar alguma coisa.
  if (!usarModulos) return [];
  try {
    const r = await cliente.call('FT._LIST');
    return Array.isArray(r) ? r.map((x) => String(x)).sort((a, b) => a.localeCompare(b)) : [];
  } catch {
    return [];
  }
}

/** O nó de um ramo ou de uma chave. */
function noDaChave(
  prefixo: string,
  ramo: { nome: string; prefixo: string; quantas: number; ehChave: boolean }
): TreeNode {
  return {
    id: ramo.ehChave ? `${prefixo}${ramo.nome}` : ramo.prefixo,
    label: ramo.nome,
    icon: ramo.ehChave ? 'key' : 'folder',
    detail: ramo.ehChave && ramo.quantas === 1 ? undefined : String(ramo.quantas),
    // Uma chave que TAMBÉM é prefixo continua expansível.
    hasChildren: !ramo.ehChave || ramo.quantas > 1,
    meta: { chave: ramo.ehChave ? `${prefixo}${ramo.nome}` : undefined, prefixo: ramo.prefixo },
  };
}

interface Varredura {
  readonly acumulado: AcumuladoDeRamos;
  /** `'0'` quando acabou; qualquer outro valor é de onde continuar. */
  readonly cursor: string;
  readonly completa: boolean;
  readonly chavesVistas: number;
}

/**
 * Varre o espaço de chaves somando ao acumulado, sem guardar as chaves.
 *
 * `MATCH` é aplicado pelo SERVIDOR, então o filtro não custa tráfego. `COUNT` é
 * uma dica de quantas olhar por rodada — não um limite —, e subi-la troca
 * viagens de rede por trabalho do servidor em cada uma.
 */
async function varrer(
  cliente: Redis,
  padrao: string,
  prefixo: string,
  cursorInicial: string,
  acumulado: AcumuladoDeRamos
): Promise<Varredura> {
  const limite = Date.now() + ORCAMENTO_MS;
  let cursor = cursorInicial;
  let vistas = 0;

  do {
    const [proximo, lote] = await cliente.scan(cursor, 'MATCH', padrao, 'COUNT', POR_RODADA);
    acumularRamos(acumulado, lote, prefixo);
    vistas += lote.length;
    cursor = proximo;
  } while (cursor !== '0' && Date.now() < limite);

  return { acumulado, cursor, completa: cursor === '0', chavesVistas: vistas };
}

async function connect(config: ResolvedConfig): Promise<Session> {
  const lido = destinoDaConexao(config.fields as Record<string, unknown>);
  if ('erro' in lido) throw new Error(lido.erro);
  const d = lido.destino;
  const campos = config.fields as Record<string, unknown>;

  const cliente = new Redis({
    host: d.host,
    port: d.porta,
    // Só manda o que existe: `username: ''` faria o ioredis emitir `AUTH '' senha`.
    ...(d.usuario === '' ? {} : { username: d.usuario }),
    ...(d.senha === '' ? {} : { password: d.senha }),
    db: d.banco,
    ...(d.tls ? { tls: {} } : {}),
    // Falhar RÁPIDO: o padrão do ioredis é tentar para sempre, e a IDE ficaria
    // dizendo "conectando…" sem fim quando o host estivesse errado.
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    connectTimeout: 10_000,
    // Descobre o par morto em dezenas de segundos, e não em horas.
    keepAlive: 20_000,
  });

  await cliente.connect();

  // O modo é decidido DEPOIS de conectar, com o que o servidor respondeu — e a
  // marca dele vence a detecção. Ver `modoDeConexao`.
  let clusterHabilitado = false;
  try {
    const info = await cliente.info('cluster');
    clusterHabilitado = /cluster_enabled:1/.test(info);
  } catch {
    // Servidor que recusa `INFO` (ACL apertada) não é erro: segue standalone.
  }
  const modo = modoDeConexao(d.standalone, clusterHabilitado);

  /**
   * Onde cada nó parou de varrer.
   *
   * Guardado por PREFIXO, e não por nó da árvore: o mesmo prefixo aberto duas
   * vezes é a mesma varredura, e recomeçar do zero refaria trabalho que o
   * servidor já fez.
   */
  const varreduras = new Map<string, Varredura>();

  // --- o que o cadastro diz sobre a árvore (03/09/2026, ele) ---
  const marcado = (v: unknown, padrao: boolean): boolean =>
    v === undefined || v === '' ? padrao : v === true || v === 'true';

  const usarModulos = marcado(campos.modulos, true);
  const mostrarBancos = marcado(campos.todos_bancos, false);
  const escolhidos = lerListaDeBancos(
    typeof campos.bancos_visiveis === 'string' ? campos.bancos_visiveis : undefined
  );

  /** O banco em que a conexão está agora — a chave da varredura depende dele. */
  let bancoAtual = d.banco;

  /**
   * Os bancos, com quantas chaves cada um tem.
   *
   * `CONFIG GET` é recusado por quase todo servidor gerenciado, e `INFO` quase
   * nunca: por isso um cai no padrão e o outro, quando falha, só deixa a
   * contagem de fora — a árvore nasce de qualquer jeito.
   */
  const listarBancos = async (): Promise<readonly BancoDoRedis[]> => {
    let quantos = QUANTOS_BANCOS_PADRAO;
    try {
      quantos = lerQuantosBancos(await cliente.call('CONFIG', 'GET', 'databases'));
    } catch {
      // Servidor que não deixa ler a configuração: 16 é o padrão do Redis.
    }
    let contagens: ReadonlyMap<number, number> | undefined;
    try {
      contagens = lerKeyspace(String(await cliente.info('keyspace')));
    } catch {
      // Sem `INFO`, a árvore mostra os bancos sem dizer quantas chaves têm.
    }
    return bancosVisiveis({
      todos: true, bancoDaConexao: d.banco, quantos, escolhidos, contagens,
    });
  };

  const executar = async (request: ExecuteRequest): Promise<QueryResult> => {
    const comeco = Date.now();
    const comando = lerComando(request.statement);
    if (comando === null) throw new Error('Digite um comando — por exemplo `GET minha-chave`.');

    if (config.readOnly && !podeRodarSomenteLeituraComModulos(comando.nome)) {
      throw new Error(
        `Esta conexão está em somente-leitura, e "${comando.nome}" não é um comando de ` +
          'leitura. O Redis não tem trava de sessão como os bancos SQL, então a IDE usa ' +
          'uma lista de comandos permitidos — o que não está nela é recusado.'
      );
    }

    const resposta = await cliente.call(
      comando.nome,
      ...(comando.argumentos as string[])
    );

    // `FT.SEARCH` não devolve uma lista de valores: devolve documentos. Mostrá-los
    // com o achatamento do Mongo é o que faz duas linhas serem comparáveis — que
    // é o ponto de uma grade.
    if (comando.nome.toLowerCase() === 'ft.search') {
      const busca = lerRespostaDeBusca(resposta);
      const docs = busca.acertos.map((a) => ({
        _chave: a.chave,
        ...abrirCampoJson(a.campos),
      }));
      const colunasDoc = colunasDaAmostra(docs);
      return {
        columns: colunasDoc.map((name) => ({ name, type: 'redis' })),
        rows: linhasDosDocumentos(docs, colunasDoc).map((l) => [...l]),
        rowCount: docs.length,
        durationMs: Date.now() - comeco,
        // O índice pode ter mais acertos do que o `LIMIT` trouxe.
        truncated: busca.total > docs.length,
      };
    }

    const { colunas, linhas } = linhasDaResposta(resposta);
    return {
      columns: colunas.map((name) => ({ name, type: 'redis' })),
      rows: linhas.map((l) => [...l]),
      rowCount: linhas.length,
      durationMs: Date.now() - comeco,
      truncated: false,
    };
  };

  return {
    kind: 'kv',

    children: async (nodePath) => {
      // A forma da árvore, de fora para dentro:
      //
      //     servidor → [db0, db1…] → Índices | Chaves → prefixos → chave
      //
      // O nível dos bancos só existe com "todos os bancos" ligado. O nó de
      // servidor existe SEMPRE, e é ele que faltava: sem um nó na raiz, o
      // caminho de um filho começava na própria categoria, e o teste de nível
      // devolvia a raiz de novo — expandir `Chaves` mostrava `Chaves`.
      if (nodePath.length === 0) {
        return [{
          id: SERVER_ID, label: config.label, icon: 'server', hasChildren: true,
        }];
      }
      if (nodePath[0] !== SERVER_ID) return [];

      // Do nó de servidor para dentro, o caminho é relativo a ele.
      let resto = nodePath.slice(1);

      if (mostrarBancos && resto.length === 0) {
        const lista = await listarBancos();
        return lista.map((banco): TreeNode => ({
          id: banco.rotulo,
          label: banco.rotulo,
          icon: 'database',
          detail: banco.chaves === undefined ? undefined : String(banco.chaves),
          hasChildren: true,
          meta: { database: banco.rotulo },
        }));
      }

      if (mostrarBancos) {
        // O `SELECT` do Redis é ESTADO DA CONEXÃO, e não parâmetro do comando:
        // sem trocar aqui, varrer `db3` leria as chaves do banco anterior, e
        // leria calado.
        const numero = bancoDoRotulo(resto[0]);
        if (numero === null) return [];
        await cliente.select(numero);
        bancoAtual = numero;
        resto = resto.slice(1);
      }

      // **A raiz do banco tem duas categorias**, e a ordem não é decorativa:
      // ele usa índices na maioria dos casos, então `Índices` vem primeiro e
      // `Chaves` depois. Numa base com milhões de chaves, abrir a árvore de
      // prefixos é o caminho caro; buscar num índice é o barato.
      if (resto.length === 0) {
        const indices = await listarIndices(cliente, usarModulos);
        const raiz: TreeNode[] = [];
        if (indices.length > 0) {
          raiz.push({
            id: CATEGORIA_INDICES,
            label: 'Índices',
            icon: 'search',
            detail: String(indices.length),
            hasChildren: true,
            meta: { categoria: 'indices' },
          });
        }
        raiz.push({
          id: CATEGORIA_CHAVES,
          label: 'Chaves',
          icon: 'folder',
          hasChildren: true,
          meta: { categoria: 'chaves' },
        });
        return raiz;
      }

      if (resto[0] === CATEGORIA_INDICES) {
        if (resto.length > 1) return [];
        const indices = await listarIndices(cliente, usarModulos);
        return indices.map((nome): TreeNode => ({
          id: nome,
          label: nome,
          icon: 'search',
          hasChildren: false,
          meta: { indice: nome },
          actions: [{ id: 'redis-buscar', label: 'Abrir busca' }],
        }));
      }

      if (resto[0] !== CATEGORIA_CHAVES) return [];

      // Abaixo de `Chaves`: a árvore de prefixos. O último pedaço do caminho JÁ
      // é o prefixo inteiro — `noDaChave` monta o id assim.
      const prefixo = resto.length === 1 ? '' : (resto[resto.length - 1] ?? '');
      const padrao = prefixo === '' ? '*' : `${prefixo}*`;

      // A varredura é guardada por BANCO e prefixo: o mesmo prefixo em db0 e em
      // db3 são duas varreduras, e misturá-las mostraria chave que não existe.
      const chaveDaVarredura = `${bancoAtual}\u0000${prefixo}`;
      const anterior = varreduras.get(chaveDaVarredura);
      const r = await varrer(
        cliente,
        padrao,
        prefixo,
        anterior?.cursor ?? '0',
        anterior?.acumulado ?? new Map()
      );
      varreduras.set(chaveDaVarredura, r);

      const nos = ramosDoAcumulado(r.acumulado, prefixo).map((ramo) => noDaChave(prefixo, ramo));
      if (r.completa) return nos;

      // **A árvore diz que ainda não acabou**, em vez de truncar em silêncio.
      // Recarregar o nó continua da mesma posição — e é por isso que o cursor
      // fica guardado por prefixo.
      return [
        ...nos,
        {
          id: `${prefixo}\u0000continuar`,
          label: `… ainda varrendo (${r.chavesVistas.toLocaleString('pt-BR')} chaves até aqui)`,
          icon: 'clock',
          hasChildren: false,
          detail: 'recarregue este nó para continuar',
          meta: { parcial: true },
        },
      ];
    },

    execute: executar,

    // Abrir uma chave (spec 089). O `bancoAtual` importa: com "todos os bancos"
    // ligado, a chave clicada pode estar noutro banco que não o da conexão.
    readKey: async (chave) => lerChave(cliente, chave),
    writeKey: async (pedido) => {
      if (config.readOnly) {
        throw new Error(
          'Esta conexão está em somente-leitura: gravar uma chave é escrita.'
        );
      }
      await gravarChave(cliente, pedido);
    },
    deleteKey: async (pedido) => {
      if (config.readOnly) {
        throw new Error('Esta conexão está em somente-leitura: apagar é escrita.');
      }
      return apagarChave(cliente, pedido);
    },
    estadoDoServidor: async () => estadoDoServidor(cliente),

    runAction: async (request) => {
      const indice = request.nodePath[request.nodePath.length - 1] ?? '';
      return {
        kind: 'statement',
        title: indice,
        // `*` é "tudo" no RediSearch. O esqueleto já traz o `LIMIT`, porque um
        // índice grande sem limite devolve o servidor inteiro para a grade.
        content: `FT.SEARCH ${indice} "*" LIMIT 0 50`,
      };
    },

    /**
     * Interrompe o comando em andamento.
     *
     * **O Redis não tem cancelamento por comando**, e não adianta fingir: o
     * protocolo é uma fila, e o servidor já está executando o que recebeu. O que
     * existe é derrubar a conexão — o comando termina no servidor, mas a IDE
     * para de esperar e a tela destrava, que é o que o botão promete.
     *
     * `connect()` em seguida devolve a sessão ao ar sem o usuário reabrir a
     * conexão. Sem isso, parar uma consulta mataria a conexão inteira.
     */
    cancelQuery: async () => {
      cliente.disconnect();
      await cliente.connect();
    },

    serverInfo: async () => {
      const info = await cliente.info('server');
      const versao = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? '?';
      return { version: versao, extra: `${modo}${d.tls ? ' · TLS' : ''}` };
    },

    close: async () => {
      cliente.disconnect();
    },
  } as Session;
}

export const redisDriver: Driver = {
  type: 'redis',
  label: 'Redis',
  kind: 'kv',
  panel: 'database',
  cli: CLI_REDIS,
  icon: 'devicon:redis',
  defaultPort: PORTA_PADRAO,
  fields: CAMPOS,
  connect,
};
