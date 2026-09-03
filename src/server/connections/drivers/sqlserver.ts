// SQL Server: o quarto SQL, na mesma árvore e na mesma grade.
//
// O que ele faz diferente — colchetes, `OFFSET/FETCH`, `TOP` — mora em
// `shared/sql/sqlserver-modelo.ts`, testado sem servidor.
//
// **Ele é o único SQL sem somente-leitura de sessão**, e a IDE diz isso em vez
// de fingir. Ver `PORQUE_SEM_TRAVA`.
import { Connection, Request } from 'tedious';
import type { Driver, ResolvedConfig, Session, TreeNode } from '../types';
import type { ExecuteRequest, FieldSpec, QueryResult } from '../../../shared/contracts';
import { formatCell } from './sql-base';
import { PORQUE_SEM_TRAVA, selectDeAmostra } from '../../../shared/sql/sqlserver-modelo';
import {
  CAMPOS_DE_ARVORE, CATEGORIAS, colunasSql, contagensSql, expandeEmColunas,
  nosDeCategoria, objetosSql,
} from './sqlserver-objetos';

export const PORTA_PADRAO = 1433;

const CAMPOS: readonly FieldSpec[] = [
  { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1' },
  { name: 'port', label: 'Porta', type: 'number', default: PORTA_PADRAO },
  {
    name: 'instance',
    label: 'Instância nomeada',
    type: 'string',
    placeholder: 'SQLEXPRESS',
    help:
      'Quando preenchida, a PORTA é ignorada: quem diz em que porta a instância ' +
      'atende é o SQL Browser, na 1434/UDP. Se ele estiver desligado, use a porta.',
  },
  { name: 'user', label: 'Usuário', type: 'string', required: true },
  { name: 'password', label: 'Senha', type: 'string', secret: true },
  { name: 'main_database', label: 'Banco principal', type: 'string', default: 'master',
    help: 'Vai para o topo da árvore.' },
  // Os interruptores de categoria (03/09/2026, ele).
  ...CAMPOS_DE_ARVORE,
  {
    name: 'encrypt',
    label: 'Criptografar a conexão',
    type: 'boolean',
    default: true,
    help: 'Ligado por padrão: é o que o driver moderno espera, e o tráfego vai em claro sem ele.',
  },
  {
    name: 'trust_certificate',
    label: 'Confiar no certificado do servidor',
    type: 'boolean',
    default: true,
    section: 'Avançado',
    help:
      'Necessário quando o servidor usa certificado próprio, que é o caso da maioria ' +
      'das instalações internas. Desligue se o certificado for de uma autoridade real.',
  },
];

interface LinhaBruta {
  readonly colunas: readonly { readonly nome: string; readonly valor: unknown }[];
}

/** Roda um comando e devolve as linhas. */
function consultar(conexao: Connection, sql: string): Promise<{
  colunas: string[];
  linhas: LinhaBruta[];
}> {
  return new Promise((resolver, rejeitar) => {
    const linhas: LinhaBruta[] = [];
    let colunas: string[] = [];

    const pedido = new Request(sql, (erro) => {
      if (erro) rejeitar(erro);
      else resolver({ colunas, linhas });
    });

    // Os eventos do `Request` não estão no tipo público do tedious, e por isso
    // a ponte é explícita: é a fronteira com a biblioteca, e não um atalho.
    const eventos = pedido as unknown as {
      on(evento: string, ouvinte: (...args: never[]) => void): void;
    };
    eventos.on('columnMetadata', ((metadados: { colName: string }[]) => {
      colunas = metadados.map((m) => m.colName);
    }) as never);
    eventos.on('row', ((colunasDaLinha: { metadata: { colName: string }; value: unknown }[]) => {
      linhas.push({
        colunas: colunasDaLinha.map((c) => ({ nome: c.metadata.colName, valor: c.value })),
      });
    }) as never);

    conexao.execSql(pedido);
  });
}

async function abrir(config: ResolvedConfig): Promise<Connection> {
  const f = config.fields as Record<string, unknown>;
  const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const marcado = (v: unknown, padrao: boolean): boolean =>
    v === undefined ? padrao : v === true || v === 'true';

  const instancia = texto(f.instance);

  const conexao = new Connection({
    server: texto(f.host) === '' ? '127.0.0.1' : texto(f.host),
    authentication: {
      type: 'default',
      options: {
        userName: texto(f.user),
        password: typeof f.password === 'string' ? f.password : '',
      },
    },
    options: {
      // Instância nomeada e porta são EXCLUDENTES no tedious: mandar as duas
      // faz ele ignorar a instância em silêncio, e a conexão vai para o
      // servidor errado sem nenhum aviso.
      ...(instancia === ''
        ? { port: f.port === undefined || f.port === '' ? PORTA_PADRAO : Number(f.port) }
        : { instanceName: instancia }),
      database: texto(f.main_database) === '' ? 'master' : texto(f.main_database),
      encrypt: marcado(f.encrypt, true),
      trustServerCertificate: marcado(f.trust_certificate, true),
      connectTimeout: 10_000,
      rowCollectionOnRequestCompletion: false,
    },
  });

  await new Promise<void>((resolver, rejeitar) => {
    conexao.on('connect', (erro) => (erro ? rejeitar(erro) : resolver()));
    conexao.connect();
  });
  return conexao;
}

const BANCOS_SQL = `
  SELECT name FROM sys.databases
   WHERE state = 0 AND name NOT IN ('tempdb')
   ORDER BY name`;

const SERVER_ID = '@servidor';

async function connect(config: ResolvedConfig): Promise<Session> {
  const conexao = await abrir(config);
  const f = config.fields as Record<string, unknown>;
  const principal =
    typeof f.main_database === 'string' && f.main_database.trim() !== ''
      ? f.main_database.trim()
      : 'master';

  const bancos = async (): Promise<TreeNode[]> => {
    const { linhas } = await consultar(conexao, BANCOS_SQL);
    const nomes = linhas.map((l) => String(l.colunas[0]?.valor ?? ''));
    const ordenados = [
      ...nomes.filter((n) => n === principal),
      ...nomes.filter((n) => n !== principal),
    ];
    return ordenados.map((nome): TreeNode => ({
      id: nome, label: nome, icon: 'database', hasChildren: true,
      meta: { database: nome },
    }));
  };

  return {
    kind: 'sql',

    // Servidor → banco → categoria → objeto → coluna, como nos outros três SQL.
    children: async (nodePath) => {
      if (nodePath.length === 0) {
        return [{
          id: SERVER_ID, label: config.label, icon: 'server', hasChildren: true,
        }];
      }
      if (nodePath[0] !== SERVER_ID) return [];
      if (nodePath.length === 1) return bancos();

      const nomeDoBanco = nodePath[1] ?? principal;

      if (nodePath.length === 2) {
        const { linhas } = await consultar(conexao, contagensSql(nomeDoBanco));
        const contagens: Record<string, unknown> = {};
        for (const coluna of linhas[0]?.colunas ?? []) contagens[coluna.nome] = coluna.valor;
        return nosDeCategoria(nomeDoBanco, contagens, config.fields);
      }

      if (nodePath.length === 3) {
        const categoria = CATEGORIAS.find((c) => c.id === nodePath[2]);
        if (categoria === undefined) return [];
        const { linhas } = await consultar(conexao, objetosSql(nomeDoBanco, categoria));
        return linhas.map((l): TreeNode => {
          const nome = String(l.colunas[0]?.valor ?? '');
          const dono = String(l.colunas[1]?.valor ?? '');
          return {
            id: dono === '' ? nome : `${dono}.${nome}`,
            label: nome,
            // O schema só vira detalhe quando NÃO é o `dbo`: repetir "dbo" em
            // cada linha de um banco inteiro é ruído. Em `triggers` o detalhe é
            // a tabela de quem o gatilho pende, e essa sempre importa.
            detail:
              categoria.id === 'triggers'
                ? (dono === '' ? undefined : dono)
                : (dono === 'dbo' || dono === '' ? undefined : dono),
            icon: categoria.icon,
            hasChildren: categoria.expande,
            meta: {
              database: nomeDoBanco, schema: dono, object: nome, category: categoria.id,
            },
            ...(categoria.expande ? { actions: [{ id: 'select', label: 'Abrir consulta' }] } : {}),
          };
        });
      }

      if (nodePath.length === 4 && expandeEmColunas(nodePath[2])) {
        const inteiro = nodePath[3] ?? '';
        const ponto = inteiro.indexOf('.');
        const schema = ponto === -1 ? 'dbo' : inteiro.slice(0, ponto);
        const objeto = ponto === -1 ? inteiro : inteiro.slice(ponto + 1);
        const { linhas } = await consultar(conexao, colunasSql(nomeDoBanco, schema, objeto));
        return linhas.map((l): TreeNode => ({
          id: String(l.colunas[0]?.valor ?? ''),
          label: String(l.colunas[0]?.valor ?? ''),
          icon: 'column',
          detail: [
            String(l.colunas[1]?.valor ?? ''),
            String(l.colunas[2]?.valor ?? '') === 'NO' ? 'NOT NULL' : null,
          ].filter((p) => p !== null && p !== '').join(' · '),
          hasChildren: false,
          meta: { database: nomeDoBanco, schema, object: objeto },
        }));
      }

      return [];
    },

    execute: async (request: ExecuteRequest): Promise<QueryResult> => {
      const comeco = Date.now();
      if (config.readOnly) {
        // A verdade, e não uma trava de mentira. Ver PORQUE_SEM_TRAVA.
        throw new Error(
          `Esta conexão está marcada como somente-leitura, e ${PORQUE_SEM_TRAVA}`
        );
      }
      const { colunas, linhas } = await consultar(conexao, request.statement);
      const limite = request.rowLimit ?? 500;
      const cortado = linhas.length > limite;
      const usadas = cortado ? linhas.slice(0, limite) : linhas;

      return {
        columns: colunas.map((name) => ({ name, type: 'sqlserver' })),
        rows: usadas.map((l) => l.colunas.map((c) => formatCell(c.valor))),
        rowCount: usadas.length,
        durationMs: Date.now() - comeco,
        truncated: cortado,
      };
    },

    /**
     * Interrompe a consulta em andamento.
     *
     * O `tedious` sabe fazer isso de verdade: manda um pacote de ATENÇÃO ao
     * servidor, que aborta o comando e mantém a conexão viva. É o único dos
     * quatro serviços novos com cancelamento nativo.
     */
    cancelQuery: async () => {
      conexao.cancel();
    },

    runAction: async (request) => {
      const [, , alvo] = request.nodePath;
      const [esquema = 'dbo', tabela = ''] = String(alvo ?? '').split('.');
      return { kind: 'statement', title: tabela, content: selectDeAmostra(esquema, tabela) };
    },

    serverInfo: async () => {
      const { linhas } = await consultar(conexao, 'SELECT @@VERSION AS v');
      const bruto = String(linhas[0]?.colunas[0]?.valor ?? '');
      return {
        version: bruto.split('\n')[0]?.trim() ?? '?',
        extra: config.readOnly ? 'somente-leitura NÃO imposto pelo servidor' : undefined,
      };
    },

    close: async () => {
      conexao.close();
    },
  } as Session;
}

export const sqlserverDriver: Driver = {
  type: 'sqlserver',
  label: 'SQL Server',
  kind: 'sql',
  panel: 'database',
  icon: 'devicon:microsoftsqlserver',
  defaultPort: PORTA_PADRAO,
  fields: CAMPOS,
  connect,
};
