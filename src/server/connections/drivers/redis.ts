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
  podeRodarSomenteLeitura, ramosDe,
} from '../../../shared/sql/redis-modelo';

export const PORTA_PADRAO = 6379;

/** Teto de chaves varridas por abertura de nó. */
const MAX_CHAVES = 5_000;

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
    label: 'Usar TLS',
    type: 'boolean',
    default: false,
    help: 'Soma com o esquema: `rediss://` já é TLS, e desmarcar aqui não o desliga.',
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

async function varrer(cliente: Redis, padrao: string): Promise<string[]> {
  const achadas: string[] = [];
  let cursor = '0';
  do {
    const [proximo, lote] = await cliente.scan(cursor, 'MATCH', padrao, 'COUNT', 500);
    achadas.push(...lote);
    cursor = proximo;
  } while (cursor !== '0' && achadas.length < MAX_CHAVES);
  return achadas;
}

async function connect(config: ResolvedConfig): Promise<Session> {
  const lido = destinoDaConexao(config.fields as Record<string, unknown>);
  if ('erro' in lido) throw new Error(lido.erro);
  const d = lido.destino;

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

  const executar = async (request: ExecuteRequest): Promise<QueryResult> => {
    const comeco = Date.now();
    const comando = lerComando(request.statement);
    if (comando === null) throw new Error('Digite um comando — por exemplo `GET minha-chave`.');

    if (config.readOnly && !podeRodarSomenteLeitura(comando.nome)) {
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
      // A raiz lista o primeiro nível; cada nível abaixo usa o prefixo do nó.
      const prefixo = nodePath.length <= 1 ? '' : (nodePath[nodePath.length - 1] ?? '');
      const chaves = await varrer(cliente, prefixo === '' ? '*' : `${prefixo}*`);
      return ramosDe(chaves, prefixo).map((r) => noDaChave(prefixo, r));
    },

    execute: executar,

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
  icon: 'devicon:redis',
  defaultPort: PORTA_PADRAO,
  fields: CAMPOS,
  connect,
};
