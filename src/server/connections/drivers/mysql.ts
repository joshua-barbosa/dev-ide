// Driver MySQL / MariaDB, sobre mysql2.
//
// Usa a API de callback (não a /promise) de propósito: só ela expõe
// `query.stream()`, que permite parar de puxar linhas ao atingir o limite em
// vez de carregar o resultado inteiro na memória — importante em tabelas com
// dezenas de milhões de linhas.
//
// Somente-leitura é imposto pelo servidor com SET SESSION TRANSACTION READ ONLY,
// o mesmo mecanismo do comando `db`; não há filtro de texto no SQL.
import * as fs from 'fs';
import mysql, { Connection, FieldPacket, Types } from 'mysql2';
import { ICONES_DE_SERVICO } from '../../../shared/icons';
import { TEMPLATES_MYSQL } from '../../../shared/tree/templates';
import { CLI_MYSQL } from '../../../shared/terminal/clientes/mysql';
import type {
  OpcoesDeNavegacao,
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
  mainFirst,
  parseNameList,
  quoteIdentifier,
  resolveRowLimit,
  resolveTimeout,
  type VisibilityOptions,
} from './sql-base';

const SERVER_ID = 'server';

/** Schemas que o MySQL mantém para si; escondidos por padrão. */
const SCHEMAS_SISTEMA = ['information_schema', 'performance_schema', 'mysql', 'sys'];

/** Preferências de exibição da árvore, vindas dos campos da conexão. */
interface Exibicao {
  /** Banco expandido por padrão; vai para o topo da lista. */
  readonly main: string;
  readonly visibilidade: VisibilityOptions;
  readonly rowLimit: number;
}

/** Códigos numéricos de tipo -> nome legível, para o cabeçalho do grid. */
const TYPE_NAMES = new Map<number, string>(
  Object.entries(Types)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, code]) => [code, name.toLowerCase()])
);

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
}

const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', icon: 'table' },
  { id: 'views', label: 'Views', icon: 'view' },
  { id: 'functions', label: 'Functions', icon: 'function' },
  { id: 'procedures', label: 'Procedures', icon: 'procedure' },
];

function query<T>(conn: Connection, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) reject(new Error(err.message));
      else resolve(rows as T[]);
    });
  });
}

/** Formata bytes como "64.1G", igual ao que a árvore mostra ao lado do banco. */
function tamanho(bytes: number | null): string | undefined {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const unidades = ['B', 'K', 'M', 'G', 'T'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return i === 0 ? `${valor}B` : `${valor.toFixed(1)}${unidades[i]}`;
}

function contagem(valor: unknown): string | undefined {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n) : undefined;
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

async function listarBancos(conn: Connection, exibicao: Exibicao): Promise<TreeNode[]> {
  const linhas = await query<{ SCHEMA_NAME: string; bytes: string | number | null }>(
    conn,
    `SELECT s.SCHEMA_NAME,
            (SELECT SUM(t.DATA_LENGTH + t.INDEX_LENGTH)
               FROM information_schema.TABLES t
              WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME) AS bytes
       FROM information_schema.SCHEMATA s
      ORDER BY s.SCHEMA_NAME`
  );

  const visiveis = applyVisibility(linhas, (linha) => linha.SCHEMA_NAME, exibicao.visibilidade);
  const ordenados = mainFirst(visiveis, exibicao.main, (linha) => linha.SCHEMA_NAME);

  return ordenados.map((linha) => ({
    id: linha.SCHEMA_NAME,
    label: linha.SCHEMA_NAME,
    icon: 'database' as const,
    detail: tamanho(linha.bytes === null ? null : Number(linha.bytes)),
    hasChildren: true,
    meta: {
      schema: linha.SCHEMA_NAME,
      main: linha.SCHEMA_NAME.toLowerCase() === exibicao.main.trim().toLowerCase(),
    },
  }));
}

const CONTAGENS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE') AS tables,
    (SELECT COUNT(*) FROM information_schema.VIEWS  WHERE TABLE_SCHEMA = ?) AS views,
    (SELECT COUNT(*) FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION')  AS functions,
    (SELECT COUNT(*) FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE') AS procedures
`;

async function listarCategorias(conn: Connection, schema: string): Promise<TreeNode[]> {
  const [contagens = {}] = await query<Record<string, unknown>>(conn, CONTAGENS_SQL, [
    schema,
    schema,
    schema,
    schema,
  ]);
  return CATEGORIAS.map((categoria) => ({
    id: categoria.id,
    label: categoria.label,
    icon: categoria.icon,
    detail: contagem(contagens[categoria.id]),
    hasChildren: true,
    // `categoria: true` é o que liga as ações de recarregar/filtrar/criar na
    // interface, sem que ela precise saber quais nomes são categorias.
    meta: { schema, categoria: true, template: TEMPLATES_MYSQL[categoria.id] },
  }));
}

/**
 * Cláusula opcional de filtro, com o padrão LIGADO.
 *
 * Devolve o pedaço de SQL e o parâmetro juntos, para não haver como acrescentar
 * um sem o outro — que é o descuido que vira injeção.
 */
function clausulaDeFiltro(coluna: string, filtro?: string | null): { sql: string; params: unknown[] } {
  return filtro === null || filtro === undefined
    ? { sql: '', params: [] }
    : { sql: ` AND ${coluna} LIKE ?`, params: [filtro] };
}

async function listarObjetos(
  conn: Connection,
  schema: string,
  categoria: string,
  filtro?: string | null
): Promise<TreeNode[]> {
  if (categoria === 'tables' || categoria === 'views') {
    const tipo = categoria === 'tables' ? 'BASE TABLE' : 'VIEW';
    const f = clausulaDeFiltro('TABLE_NAME', filtro);
    const linhas = await query<{ TABLE_NAME: string; TABLE_ROWS: number | null }>(
      conn,
      `SELECT TABLE_NAME, TABLE_ROWS
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?${f.sql}
        ORDER BY TABLE_NAME`,
      [schema, tipo, ...f.params]
    );
    return linhas.map((linha) => ({
      id: linha.TABLE_NAME,
      label: linha.TABLE_NAME,
      icon: (categoria === 'tables' ? 'table' : 'view') as TreeNode['icon'],
      // TABLE_ROWS é estimativa no InnoDB — suficiente para orientar, não para contar.
      detail: linha.TABLE_ROWS === null ? undefined : contagem(linha.TABLE_ROWS),
      hasChildren: true,
      actions: [
        { id: 'select', label: 'Abrir Query' },
        { id: 'ddl', label: 'Ver DDL' },
        { id: 'count', label: 'Contar linhas (exato)' },
      ],
      meta: { schema, object: linha.TABLE_NAME, category: categoria },
    }));
  }

  const tipo = categoria === 'functions' ? 'FUNCTION' : 'PROCEDURE';
  const f = clausulaDeFiltro('ROUTINE_NAME', filtro);
  const linhas = await query<{ ROUTINE_NAME: string; DTD_IDENTIFIER: string | null }>(
    conn,
    `SELECT ROUTINE_NAME, DTD_IDENTIFIER
       FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?${f.sql}
      ORDER BY ROUTINE_NAME`,
    [schema, tipo, ...f.params]
  );
  return linhas.map((linha) => ({
    id: linha.ROUTINE_NAME,
    label: linha.ROUTINE_NAME,
    icon: (categoria === 'functions' ? 'function' : 'procedure') as TreeNode['icon'],
    detail: linha.DTD_IDENTIFIER ?? undefined,
    hasChildren: false,
    meta: { schema, object: linha.ROUTINE_NAME, category: categoria },
  }));
}

async function listarColunas(conn: Connection, schema: string, objeto: string): Promise<TreeNode[]> {
  const linhas = await query<{
    COLUMN_NAME: string;
    COLUMN_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_KEY: string;
  }>(
    conn,
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, objeto]
  );
  return linhas.map((linha) => {
    const marcas = [linha.COLUMN_TYPE];
    if (linha.COLUMN_KEY === 'PRI') marcas.push('PK');
    if (linha.IS_NULLABLE === 'NO') marcas.push('NOT NULL');
    return {
      id: linha.COLUMN_NAME,
      label: linha.COLUMN_NAME,
      icon: 'column' as const,
      detail: marcas.join(' · '),
      hasChildren: false,
      meta: { schema, object: objeto, column: linha.COLUMN_NAME },
    };
  });
}

async function navegar(
  conn: Connection,
  rotulo: string,
  versao: string,
  exibicao: Exibicao,
  nodePath: readonly string[],
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  if (nodePath.length === 0) {
    return [
      { id: SERVER_ID, label: rotulo, icon: 'server', detail: versao, hasChildren: true },
    ];
  }
  if (nodePath[0] !== SERVER_ID) return [];
  if (nodePath.length === 1) return listarBancos(conn, exibicao);
  if (nodePath.length === 2) return listarCategorias(conn, nodePath[1]);
  if (nodePath.length === 3) return listarObjetos(conn, nodePath[1], nodePath[2], opcoes?.filtro);
  if (nodePath.length === 4 && (nodePath[2] === 'tables' || nodePath[2] === 'views')) {
    return listarColunas(conn, nodePath[1], nodePath[3]);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function colunasDe(fields: FieldPacket[] | undefined): ColumnInfo[] {
  return (fields ?? []).map((field) => ({
    name: field.name,
    type: TYPE_NAMES.get(field.columnType ?? -1),
  }));
}

function executar(conn: Connection, request: ExecuteRequest): Promise<QueryResult> {
  const limite = resolveRowLimit(request.rowLimit);
  const inicio = Date.now();

  return new Promise((resolve, reject) => {
    const q = conn.query(request.statement);
    let colunas: ColumnInfo[] = [];
    // 'fields' só dispara em result set; a ausência dele identifica DML/DDL.
    q.on('fields', (fields: FieldPacket[]) => {
      colunas = colunasDe(fields);
    });

    const rows: CellValue[][] = [];
    let truncated = false;
    let afetadas = 0;

    const stream = q.stream();
    stream.on('data', (registro: Record<string, unknown>) => {
      if (colunas.length === 0) {
        // OkPacket de INSERT/UPDATE/DDL: não há linhas, só o total afetado.
        afetadas = Number(registro.affectedRows ?? 0);
        return;
      }
      if (rows.length >= limite) {
        truncated = true;
        stream.destroy(); // para de puxar do servidor em vez de baixar tudo
        return;
      }
      rows.push(colunas.map((coluna) => formatCell(registro[coluna.name])));
    });

    stream.on('error', (err: Error) => reject(new Error(err.message)));
    const finalizar = () =>
      resolve({
        columns: colunas,
        rows,
        rowCount: colunas.length === 0 ? afetadas : rows.length,
        durationMs: Date.now() - inicio,
        truncated,
        message: colunas.length === 0 ? `${afetadas} linha(s) afetada(s).` : undefined,
      });
    stream.on('end', finalizar);
    stream.on('close', finalizar); // destroy() encerra por aqui
  });
}

// ---------------------------------------------------------------------------
// Ações do menu de contexto
// ---------------------------------------------------------------------------

function qualificar(schema: string, objeto: string): string {
  return `${quoteIdentifier(schema, 'backtick')}.${quoteIdentifier(objeto, 'backtick')}`;
}

/** nodePath de um objeto é [server, schema, categoria, objeto]. */
async function acao(conn: Connection, request: ActionRequest): Promise<ActionResult> {
  const [, schema, categoria, objeto] = request.nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('Ação exige um objeto selecionado.');
  }
  const alvo = qualificar(schema, objeto);

  switch (request.actionId) {
    case 'select':
      return {
        kind: 'statement',
        title: objeto,
        content: `SELECT * FROM ${alvo} LIMIT 100;`,
      };

    case 'ddl': {
      const comando = categoria === 'views' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE';
      const [linha] = await query<Record<string, string>>(conn, `${comando} ${alvo}`);
      if (linha === undefined) throw new Error(`Não foi possível ler o DDL de ${objeto}.`);
      // A coluna do DDL muda de nome conforme o objeto ("Create Table",
      // "Create View"), então pega-se a primeira que não seja o nome.
      const chave = Object.keys(linha).find((k) => /^create/i.test(k));
      return {
        kind: 'text',
        title: `${objeto} (DDL)`,
        content: chave === undefined ? JSON.stringify(linha, null, 2) : linha[chave],
      };
    }

    case 'count': {
      const [linha] = await query<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM ${alvo}`);
      return {
        kind: 'text',
        title: `${objeto} (total)`,
        content: `-- ${alvo}\n-- ${linha?.n ?? 0} linha(s)\n`,
      };
    }

    default:
      throw new Error(`Ação desconhecida: ${request.actionId}`);
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Traduz o ssl-mode do MySQL para a opção `ssl` do mysql2.
 *
 * O mysql2 não implementa TLS oportunista, então DISABLED e PREFERRED caem no
 * mesmo lugar (sem TLS): PREFERRED é "tente, mas siga sem" e a biblioteca não
 * sabe tentar. Quem precisa de garantia deve usar REQUIRED ou acima.
 */
function opcaoSsl(modo: string, ca: string): mysql.ConnectionOptions['ssl'] {
  switch (modo) {
    case 'REQUIRED':
      return { rejectUnauthorized: false };
    case 'VERIFY_CA':
    case 'VERIFY_IDENTITY':
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
  const principal = String(f.main_database ?? '');

  const exibicao: Exibicao = {
    main: principal,
    visibilidade: {
      show: parseNameList(f.show_databases),
      excludePattern: String(f.exclude_databases ?? ''),
      hideSystem: f.hide_system_schemas !== false,
      systemNames: SCHEMAS_SISTEMA,
    },
    rowLimit: resolveRowLimit(Number(f.default_row_limit)),
  };

  const socket = String(f.socket_path ?? '');
  const conn = mysql.createConnection({
    ...(socket === '' ? { host: String(f.host), port: Number(f.port) } : { socketPath: socket }),
    user: String(f.user),
    password: f.password === undefined ? undefined : String(f.password),
    // O banco principal também é o schema padrão de queries sem qualificação.
    database: principal === '' ? undefined : principal,
    ssl: opcaoSsl(String(f.ssl_mode ?? 'DISABLED'), String(f.ssl_ca ?? '')),
    // Uma instrução por chamada: evita que um snippet colado rode DDL escondida.
    multipleStatements: false,
    supportBigNumbers: true,
    connectTimeout: 15_000,
  });

  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => (err ? reject(new Error(err.message)) : resolve()));
  });

  // OBRIGATÓRIO, não defensivo: uma Connection do mysql2 é um EventEmitter, e
  // erro sem ouvinte vira exceção não tratada que MATA O PROCESSO. O servidor
  // encerra conexões ociosas por conta própria (wait_timeout), então isso
  // acontece em uso normal — e já derrubou a IDE inteira uma vez.
  const ouvintes: Array<(motivo: string) => void> = [];
  let morta = false;

  conn.on('error', (err: NodeJS.ErrnoException) => {
    morta = true;
    for (const ouvinte of ouvintes) ouvinte(err.message);
  });

  if (config.readOnly) {
    // Enforcement no servidor, igual ao --init-command do comando `db`.
    await query(conn, 'SET SESSION TRANSACTION READ ONLY');
  }
  await query(conn, 'SET SESSION MAX_EXECUTION_TIME = ?', [resolveTimeout(undefined)]);

  // SQL de inicialização roda depois do read-only, para não conseguir desfazê-lo.
  const startup = String(f.startup_sql ?? '').trim();
  if (startup !== '') await query(conn, startup);

  const [info] = await query<{ versao: string }>(conn, 'SELECT VERSION() AS versao');
  const versao = info?.versao ?? '';
  const rotulo = socket === '' ? `${f.host}:${f.port}` : socket;

  /** Falha cedo e com mensagem clara, em vez de estourar dentro do driver. */
  const exigirViva = (): void => {
    if (morta) {
      throw new Error(
        `A conexão com ${rotulo} foi encerrada pelo servidor. Expanda a conexão de novo para reabrir.`
      );
    }
  };

  return {
    kind: 'sql',
    onClosed: (listener) => ouvintes.push(listener),
    children: (nodePath, opcoes) => {
      exigirViva();
      return navegar(conn, rotulo, versao, exibicao, nodePath, opcoes);
    },
    execute: (request) => {
      exigirViva();
      return executar(conn, { ...request, rowLimit: request.rowLimit ?? exibicao.rowLimit });
    },
    runAction: (request) => {
      exigirViva();
      return acao(conn, request);
    },
    close: async () => {
      await new Promise<void>((resolve) => conn.end(() => resolve()));
    },
  };
}

export const mysqlDriver: Driver = {
  type: 'mysql',
  label: 'MySQL / MariaDB',
  kind: 'sql',
  panel: 'database',
  icon: ICONES_DE_SERVICO.mysql,
  defaultPort: 3306,
  cli: CLI_MYSQL,
  fields: [
    { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1' },
    { name: 'port', label: 'Porta', type: 'number', required: true, default: 3306 },
    { name: 'user', label: 'Usuário', type: 'string', required: true, default: 'root' },
    { name: 'password', label: 'Senha', type: 'password', secret: true },
    {
      name: 'main_database',
      label: 'Banco principal',
      type: 'string',
      placeholder: 'ex.: servidor-2',
      help: 'Vai para o topo da árvore e vira o schema padrão de queries sem qualificação.',
    },
    { name: 'socket_path', label: 'Socket', type: 'path', placeholder: '/var/run/mysqld/mysqld.sock' },

    {
      name: 'show_databases',
      label: 'Bancos visíveis',
      type: 'textarea',
      placeholder: 'ex.: servidor-2, servidor-1',
      help: 'Lista branca separada por vírgula ou quebra de linha. Vazio mostra todos.',
      section: 'Árvore',
    },
    {
      name: 'exclude_databases',
      label: 'Bancos excluídos',
      type: 'string',
      placeholder: 'regex, ex.: _bkp$|^teste_',
      help: 'Expressão regular. Regex inválida é ignorada.',
      section: 'Árvore',
    },
    {
      name: 'hide_system_schemas',
      label: 'Esconder schemas de sistema',
      type: 'boolean',
      default: true,
      help: 'information_schema, performance_schema, mysql e sys.',
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
      placeholder: "ex.: SET NAMES utf8mb4",
      help: 'Roda ao abrir a sessão, depois do somente-leitura.',
      section: 'SQL',
    },

    {
      name: 'ssl_mode',
      label: 'SSL Mode',
      type: 'select',
      default: 'DISABLED',
      options: [
        { value: 'DISABLED', label: 'DISABLED — sem TLS' },
        { value: 'PREFERRED', label: 'PREFERRED — tenta TLS (mysql2 trata como sem TLS)' },
        { value: 'REQUIRED', label: 'REQUIRED — exige TLS, sem verificar certificado' },
        { value: 'VERIFY_CA', label: 'VERIFY_CA — exige TLS e valida a CA' },
        { value: 'VERIFY_IDENTITY', label: 'VERIFY_IDENTITY — valida CA e hostname' },
      ],
      section: 'TLS',
    },
    {
      name: 'ssl_ca',
      label: 'Certificado da CA',
      type: 'path',
      help: 'Usado por VERIFY_CA e VERIFY_IDENTITY.',
      section: 'TLS',
    },
  ],
  connect,
};
