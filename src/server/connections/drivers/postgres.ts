// Driver PostgreSQL, sobre `pg`.
//
// Três decisões estruturais:
//
// 1. Não existe consulta cross-database no Postgres — uma conexão fala com um
//    banco só. Para a árvore mostrar todos os bancos do servidor, a sessão
//    mantém UM CLIENTE POR BANCO, criado sob demanda ao expandir o nó.
// 2. `pg` carrega o resultado inteiro na memória; o corte por linhas usa
//    pg-cursor, que busca em blocos e permite abortar cedo.
// 3. Somente-leitura é imposto pelo servidor com default_transaction_read_only.
import * as fs from 'fs';
import { Client, type ClientConfig, type FieldDef } from 'pg';
import Cursor from 'pg-cursor';
import { ICONES_DE_SERVICO } from '../../../shared/icons';
import type {
  ActionRequest,
  ActionResult,
  CellValue,
  ColumnInfo,
  Driver,
  ExecuteRequest,
  QueryResult,
  ResolvedConfig,
  Session,
  TreeNode,
} from '../types';
import {
  applyVisibility,
  formatCell,
  quoteIdentifier,
  mainFirst,
  parseNameList,
  resolveRowLimit,
  resolveTimeout,
  type VisibilityOptions,
} from './sql-base';

const SERVER_ID = 'server';
/** Schemas mantidos pelo próprio Postgres; escondidos por padrão. */
const SCHEMAS_SISTEMA = ['pg_catalog', 'information_schema'];

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
}

const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', icon: 'table' },
  { id: 'views', label: 'Views', icon: 'view' },
  { id: 'functions', label: 'Functions', icon: 'function' },
];

interface Exibicao {
  readonly main: string;
  readonly bancos: VisibilityOptions;
  readonly schemas: VisibilityOptions;
  readonly rowLimit: number;
}

// Bancos template e sem conexão permitida nunca são navegáveis.
const BANCOS_SQL = `
  SELECT d.datname AS nome,
         CASE WHEN has_database_privilege(d.datname, 'CONNECT')
              THEN pg_size_pretty(pg_database_size(d.datname)) END AS tamanho
    FROM pg_database d
   WHERE NOT d.datistemplate AND d.datallowconn
   ORDER BY d.datname
`;

const SCHEMAS_SQL = `
  SELECT n.nspname AS schema,
         pg_size_pretty(COALESCE(SUM(pg_total_relation_size(c.oid)), 0)) AS tamanho
    FROM pg_namespace n
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p', 'm')
   WHERE n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
   GROUP BY n.nspname
   ORDER BY n.nspname
`;

const CONTAGENS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE') AS tables,
    (SELECT COUNT(*) FROM information_schema.views  WHERE table_schema = $1) AS views,
    (SELECT COUNT(*) FROM information_schema.routines
      WHERE routine_schema = $1 AND routine_type = 'FUNCTION') AS functions
`;

/** Estimativa de linhas do planner (reltuples): barata, ao contrário de count(*). */
const TABELAS_SQL = `
  SELECT c.relname AS nome,
         CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS linhas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind = ANY($2)
   ORDER BY c.relname
`;

const COLUNAS_SQL = `
  SELECT a.attname AS nome,
         format_type(a.atttypid, a.atttypmod) AS tipo,
         a.attnotnull AS obrigatorio,
         COALESCE(i.indisprimary, false) AS pk
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_index i ON i.indrelid = c.oid AND a.attnum = ANY(i.indkey) AND i.indisprimary
   WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY a.attnum
`;

const FUNCOES_SQL = `
  SELECT p.proname AS nome, pg_get_function_result(p.oid) AS retorno
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = $1 AND p.prokind = 'f'
   ORDER BY p.proname
`;

function contagem(valor: unknown): string | undefined {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n) : undefined;
}

// ---------------------------------------------------------------------------
// Clientes por banco
// ---------------------------------------------------------------------------

type ClienteDe = (banco: string) => Promise<Client>;

/**
 * Mantém um cliente por banco, aberto sob demanda. Expandir um banco novo na
 * árvore abre uma conexão nova — é o único jeito no Postgres.
 */
function criarPool(base: ClientConfig, config: ResolvedConfig, startupSql: string) {
  const clientes = new Map<string, Client>();
  const abrindo = new Map<string, Promise<Client>>();
  const ouvintes: Array<(motivo: string) => void> = [];

  const abrir = async (banco: string): Promise<Client> => {
    const client = new Client({ ...base, database: banco });

    // Mesmo motivo do MySQL: um Client do pg é EventEmitter, e erro sem ouvinte
    // derruba o processo. O cliente morto sai do mapa para não ser reentregue.
    client.on('error', (err: Error) => {
      clientes.delete(banco);
      for (const ouvinte of ouvintes) ouvinte(err.message);
    });

    await client.connect();
    if (config.readOnly) {
      await client.query('SET default_transaction_read_only = on');
    }
    // Depois do read-only, para o SQL de inicialização não conseguir desfazê-lo.
    if (startupSql !== '') await client.query(startupSql);
    clientes.set(banco, client);
    return client;
  };

  const clienteDe: ClienteDe = (banco) => {
    const existente = clientes.get(banco);
    if (existente !== undefined) return Promise.resolve(existente);

    const emVoo = abrindo.get(banco);
    if (emVoo !== undefined) return emVoo;

    const promessa = abrir(banco).finally(() => abrindo.delete(banco));
    abrindo.set(banco, promessa);
    return promessa;
  };

  const fecharTudo = async (): Promise<void> => {
    const abertos = [...clientes.values()];
    clientes.clear();
    await Promise.all(abertos.map((client) => client.end().catch(() => undefined)));
  };

  const aoMorrer = (listener: (motivo: string) => void): void => {
    ouvintes.push(listener);
  };

  return { clienteDe, fecharTudo, aoMorrer };
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

async function listarBancos(client: Client, exibicao: Exibicao): Promise<TreeNode[]> {
  const { rows } = await client.query<{ nome: string; tamanho: string | null }>(BANCOS_SQL);
  const visiveis = applyVisibility(rows, (linha) => linha.nome, exibicao.bancos);

  return mainFirst(visiveis, exibicao.main, (linha) => linha.nome).map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: 'database' as const,
    detail: linha.tamanho ?? undefined,
    hasChildren: true,
    meta: { database: linha.nome, main: linha.nome === exibicao.main },
  }));
}

async function listarSchemas(client: Client, exibicao: Exibicao): Promise<TreeNode[]> {
  const { rows } = await client.query<{ schema: string; tamanho: string }>(SCHEMAS_SQL);
  const visiveis = applyVisibility(rows, (linha) => linha.schema, exibicao.schemas);

  return visiveis.map((linha) => ({
    id: linha.schema,
    label: linha.schema,
    icon: 'schema' as const,
    detail: linha.tamanho === '0 bytes' ? undefined : linha.tamanho,
    hasChildren: true,
    meta: { schema: linha.schema },
  }));
}

async function listarCategorias(client: Client, schema: string): Promise<TreeNode[]> {
  const { rows } = await client.query<Record<string, unknown>>(CONTAGENS_SQL, [schema]);
  const contagens = rows[0] ?? {};
  return CATEGORIAS.map((categoria) => ({
    id: categoria.id,
    label: categoria.label,
    icon: categoria.icon,
    detail: contagem(contagens[categoria.id]),
    hasChildren: true,
    meta: { schema },
  }));
}

async function listarObjetos(client: Client, schema: string, categoria: string): Promise<TreeNode[]> {
  if (categoria === 'functions') {
    const { rows } = await client.query<{ nome: string; retorno: string }>(FUNCOES_SQL, [schema]);
    return rows.map((linha) => ({
      id: linha.nome,
      label: linha.nome,
      icon: 'function' as const,
      detail: linha.retorno,
      hasChildren: false,
      meta: { schema, object: linha.nome, category: categoria },
    }));
  }

  // 'r' tabela, 'p' particionada, 'v' view, 'm' view materializada.
  const kinds = categoria === 'tables' ? ['r', 'p'] : ['v', 'm'];
  const { rows } = await client.query<{ nome: string; linhas: string | null }>(TABELAS_SQL, [schema, kinds]);
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: (categoria === 'tables' ? 'table' : 'view') as TreeNode['icon'],
    detail: linha.linhas === null ? undefined : contagem(linha.linhas),
    hasChildren: true,
    actions: [
      { id: 'select', label: 'Abrir Query' },
      { id: 'ddl', label: 'Ver DDL' },
      { id: 'count', label: 'Contar linhas (exato)' },
    ],
    meta: { schema, object: linha.nome, category: categoria },
  }));
}

async function listarColunas(client: Client, schema: string, objeto: string): Promise<TreeNode[]> {
  const { rows } = await client.query<{
    nome: string;
    tipo: string;
    obrigatorio: boolean;
    pk: boolean;
  }>(COLUNAS_SQL, [schema, objeto]);

  return rows.map((linha) => {
    const marcas = [linha.tipo];
    if (linha.pk) marcas.push('PK');
    if (linha.obrigatorio) marcas.push('NOT NULL');
    return {
      id: linha.nome,
      label: linha.nome,
      icon: 'column' as const,
      detail: marcas.join(' · '),
      hasChildren: false,
      meta: { schema, object: objeto, column: linha.nome },
    };
  });
}

async function navegar(
  clienteDe: ClienteDe,
  rotulo: string,
  versao: string,
  exibicao: Exibicao,
  nodePath: readonly string[]
): Promise<TreeNode[]> {
  if (nodePath.length === 0) {
    return [{ id: SERVER_ID, label: rotulo, icon: 'server', detail: versao, hasChildren: true }];
  }
  if (nodePath[0] !== SERVER_ID) return [];

  if (nodePath.length === 1) {
    return listarBancos(await clienteDe(exibicao.main), exibicao);
  }

  // Do segundo nível em diante, tudo passa pelo cliente daquele banco.
  const client = await clienteDe(nodePath[1]);
  if (nodePath.length === 2) return listarSchemas(client, exibicao);
  if (nodePath.length === 3) return listarCategorias(client, nodePath[2]);
  if (nodePath.length === 4) return listarObjetos(client, nodePath[2], nodePath[3]);
  if (nodePath.length === 5 && nodePath[3] !== 'functions') {
    return listarColunas(client, nodePath[2], nodePath[4]);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function colunasDe(fields: readonly FieldDef[] | undefined): ColumnInfo[] {
  return (fields ?? []).map((field) => ({ name: field.name }));
}

async function executar(client: Client, request: ExecuteRequest, limitePadrao: number): Promise<QueryResult> {
  const limite = resolveRowLimit(request.rowLimit ?? limitePadrao);
  const inicio = Date.now();

  // rowMode 'array' evita que colunas homônimas (SELECT a.id, b.id) se
  // sobrescrevam, o que aconteceria com linhas em objeto.
  const cursor = client.query(new Cursor<unknown[]>(request.statement, undefined, { rowMode: 'array' }));

  try {
    // Uma linha a mais que o limite: é ela que revela o truncamento.
    const { lote, fields } = await new Promise<{ lote: unknown[][]; fields: FieldDef[] }>(
      (resolve, reject) => {
        cursor.read(limite + 1, (err, rows, result) => {
          if (err) reject(new Error(err.message));
          else resolve({ lote: rows, fields: result?.fields ?? [] });
        });
      }
    );

    const colunas = colunasDe(fields);

    // Sem colunas, o comando foi DML/DDL: o cursor não devolve linhas.
    if (colunas.length === 0) {
      return {
        columns: [],
        rows: [],
        rowCount: lote.length,
        durationMs: Date.now() - inicio,
        truncated: false,
        message: 'Comando executado.',
      };
    }

    const truncated = lote.length > limite;
    const usadas = truncated ? lote.slice(0, limite) : lote;
    const rows: CellValue[][] = usadas.map((linha) => linha.map(formatCell));

    return {
      columns: colunas,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - inicio,
      truncated,
    };
  } finally {
    await cursor.close().catch(() => undefined);
  }
}


// ---------------------------------------------------------------------------
// Ações do menu de contexto
// ---------------------------------------------------------------------------

const DDL_COLUNAS_SQL = `
  SELECT a.attname AS nome,
         format_type(a.atttypid, a.atttypmod) AS tipo,
         a.attnotnull AS obrigatorio,
         pg_get_expr(d.adbin, d.adrelid) AS padrao
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY a.attnum
`;

const DDL_PK_SQL = `
  SELECT a.attname AS nome
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
   WHERE n.nspname = $1 AND c.relname = $2 AND i.indisprimary
`;

/** nodePath de um objeto é [server, banco, schema, categoria, objeto]. */
async function acao(clienteDe: ClienteDe, principal: string, request: ActionRequest): Promise<ActionResult> {
  const [, banco, schema, categoria, objeto] = request.nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('Ação exige um objeto selecionado.');
  }
  const client = await clienteDe(banco ?? principal);
  const alvo = `${quoteIdentifier(schema, 'double')}.${quoteIdentifier(objeto, 'double')}`;

  switch (request.actionId) {
    case 'select':
      return { kind: 'statement', title: objeto, content: `SELECT * FROM ${alvo} LIMIT 100;` };

    case 'ddl': {
      if (categoria === 'views') {
        const { rows } = await client.query<{ def: string }>(
          'SELECT pg_get_viewdef($1::regclass, true) AS def',
          [alvo]
        );
        return {
          kind: 'text',
          title: `${objeto} (DDL)`,
          content: `CREATE OR REPLACE VIEW ${alvo} AS\n${rows[0]?.def ?? ''}`,
        };
      }

      // O Postgres não tem SHOW CREATE TABLE: o DDL é reconstruído do catálogo.
      // Cobre colunas, NOT NULL, DEFAULT e chave primária — não índices,
      // constraints de checagem nem chaves estrangeiras.
      const [colunas, pk] = await Promise.all([
        client.query<{ nome: string; tipo: string; obrigatorio: boolean; padrao: string | null }>(
          DDL_COLUNAS_SQL, [schema, objeto]
        ),
        client.query<{ nome: string }>(DDL_PK_SQL, [schema, objeto]),
      ]);

      const linhas = colunas.rows.map((coluna) => {
        const partes = [`  ${quoteIdentifier(coluna.nome, 'double')} ${coluna.tipo}`];
        if (coluna.padrao !== null) partes.push(`DEFAULT ${coluna.padrao}`);
        if (coluna.obrigatorio) partes.push('NOT NULL');
        return partes.join(' ');
      });

      if (pk.rows.length > 0) {
        const cols = pk.rows.map((r) => quoteIdentifier(r.nome, 'double')).join(', ');
        linhas.push(`  PRIMARY KEY (${cols})`);
      }

      return {
        kind: 'text',
        title: `${objeto} (DDL)`,
        content:
          `-- Reconstruído do catálogo: sem índices, FKs e constraints de checagem.\n` +
          `CREATE TABLE ${alvo} (\n${linhas.join(',\n')}\n);\n`,
      };
    }

    case 'count': {
      const { rows } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${alvo}`);
      return {
        kind: 'text',
        title: `${objeto} (total)`,
        content: `-- ${alvo}\n-- ${rows[0]?.n ?? 0} linha(s)\n`,
      };
    }

    default:
      throw new Error(`Ação desconhecida: ${request.actionId}`);
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------


/** Traduz o sslmode do Postgres para a opção `ssl` do node-postgres. */
function opcaoSsl(modo: string, ca: string): ClientConfig['ssl'] {
  switch (modo) {
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return {
        rejectUnauthorized: true,
        ...(ca === '' ? {} : { ca: fs.readFileSync(ca, 'utf8') }),
      };
    default:
      return undefined;
  }
}

async function connect(config: ResolvedConfig): Promise<Session> {
  const f = config.fields;
  const principal = String(f.main_database === undefined || f.main_database === '' ? 'postgres' : f.main_database);

  const exibicao: Exibicao = {
    main: principal,
    bancos: {
      show: parseNameList(f.show_databases),
      excludePattern: String(f.exclude_databases ?? ''),
      hideSystem: false, // bancos template já saem pela cláusula da query
      systemNames: [],
    },
    schemas: {
      show: [],
      excludePattern: String(f.exclude_schemas ?? ''),
      hideSystem: f.hide_system_schemas !== false,
      systemNames: SCHEMAS_SISTEMA,
    },
    rowLimit: resolveRowLimit(Number(f.default_row_limit)),
  };

  const base: ClientConfig = {
    host: String(f.host),
    port: Number(f.port),
    user: String(f.user),
    password: f.password === undefined ? undefined : String(f.password),
    ssl: opcaoSsl(String(f.ssl_mode ?? 'disable'), String(f.ssl_ca ?? '')),
    connectionTimeoutMillis: 15_000,
    statement_timeout: resolveTimeout(undefined),
  };

  const { clienteDe, fecharTudo, aoMorrer } = criarPool(base, config, String(f.startup_sql ?? '').trim());
  const principalClient = await clienteDe(principal);

  // SHOW não aceita alias; current_setting devolve o mesmo valor como coluna nomeada.
  const { rows } = await principalClient.query<{ versao: string }>(
    "SELECT current_setting('server_version') AS versao"
  );
  const versao = rows[0]?.versao ?? '';
  const rotulo = `${f.host}:${f.port}`;

  return {
    kind: 'sql',
    onClosed: aoMorrer,
    children: (nodePath) => navegar(clienteDe, rotulo, versao, exibicao, nodePath),
    execute: async (request) => {
      // O banco do nó ativo manda; sem ele, cai no principal.
      const banco = request.nodePath?.[1] ?? principal;
      return executar(await clienteDe(banco), request, exibicao.rowLimit);
    },
    runAction: (request) => acao(clienteDe, principal, request),
    close: fecharTudo,
  };
}

export const postgresDriver: Driver = {
  type: 'postgres',
  label: 'PostgreSQL',
  kind: 'sql',
  panel: 'database',
  icon: ICONES_DE_SERVICO.postgres,
  defaultPort: 5432,
  fields: [
    { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1' },
    { name: 'port', label: 'Porta', type: 'number', required: true, default: 5432 },
    { name: 'user', label: 'Usuário', type: 'string', required: true, default: 'postgres' },
    { name: 'password', label: 'Senha', type: 'password', secret: true },
    {
      name: 'main_database',
      label: 'Banco principal',
      type: 'string',
      default: 'postgres',
      help: 'Banco da conexão inicial. Expandir outro banco abre uma conexão nova — o Postgres não faz consulta cross-database.',
    },

    {
      name: 'show_databases',
      label: 'Bancos visíveis',
      type: 'textarea',
      placeholder: 'ex.: nuntius, bussola',
      help: 'Lista branca separada por vírgula ou quebra de linha. Vazio mostra todos.',
      section: 'Árvore',
    },
    {
      name: 'exclude_databases',
      label: 'Bancos excluídos',
      type: 'string',
      placeholder: 'regex, ex.: _bkp$',
      help: 'Expressão regular. Regex inválida é ignorada.',
      section: 'Árvore',
    },
    {
      name: 'exclude_schemas',
      label: 'Schemas excluídos',
      type: 'string',
      placeholder: 'regex, ex.: ^_timescaledb',
      help: 'Expressão regular aplicada aos schemas de cada banco.',
      section: 'Árvore',
    },
    {
      name: 'hide_system_schemas',
      label: 'Esconder schemas de sistema',
      type: 'boolean',
      default: true,
      help: 'pg_catalog e information_schema (pg_toast e pg_temp já ficam fora).',
      section: 'Árvore',
    },

    {
      name: 'default_row_limit',
      label: 'Limite padrão de linhas',
      type: 'number',
      default: 500,
      help: 'Aplicado quando a query não pede um limite explícito.',
      section: 'SQL',
    },
    {
      name: 'startup_sql',
      label: 'SQL de inicialização',
      type: 'textarea',
      placeholder: "ex.: SET search_path TO public",
      help: 'Roda em cada banco ao abrir a conexão, depois do somente-leitura.',
      section: 'SQL',
    },

    {
      name: 'ssl_mode',
      label: 'SSL Mode',
      type: 'select',
      default: 'disable',
      options: [
        { value: 'disable', label: 'disable — sem TLS' },
        { value: 'require', label: 'require — exige TLS, sem verificar certificado' },
        { value: 'verify-ca', label: 'verify-ca — exige TLS e valida a CA' },
        { value: 'verify-full', label: 'verify-full — valida CA e hostname' },
      ],
      section: 'TLS',
    },
    {
      name: 'ssl_ca',
      label: 'Certificado da CA',
      type: 'path',
      help: 'Usado por verify-ca e verify-full.',
      section: 'TLS',
    },
  ],
  connect,
};
