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
import mysql, { Connection } from 'mysql2';
import {
  COLUNAS_ARVORE_SQL,
  COLUNAS_MODELO_SQL,
  CONTAGENS_SQL,
  PROCESSOS_SQL,
} from './mysql-sql';
import { escrever, lerCelula, lerTabela } from './mysql-tabela';
import { comandoDeCancelamento } from './cancelar';
import { estruturaDaTabela } from './mysql-estrutura';
import { DIALETOS, montarAlteracao, operacoesDisponiveis } from './alterar';
import { executar, qualificar, query } from './mysql-base';
import {
  ACOES_DE_TABELA,
  ACOES_DE_VIEW,
  modeloSql,
  type ColunaDeModelo,
} from './modelos';
import { ICONES_DE_SERVICO } from '../../../shared/icons';
import { TEMPLATES_MYSQL } from '../../../shared/tree/templates';
import { SECURITY_ID, noDeSeguranca } from './seguranca';
import type { Criterio } from '../../../shared/tree/filtro-da-arvore';
import { listarSeguranca, segurancaDisponivel } from './mysql-seguranca';
import { CLI_MYSQL } from '../../../shared/terminal/clientes/mysql';
import type {
  OpcoesDeNavegacao,
  ActionRequest,
  ActionResult,
  Driver,
  ResolvedConfig,
  Session,
  TreeNode,
} from '../types';
import {
  applyVisibility,
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


interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
  /**
   * Por que se pode filtrar AQUI (T112, spec 069).
   *
   * O MySQL não tem dono POR TABELA — quem tem dono é a rotina e o evento, pelo
   * `DEFINER`. E uma view não ocupa disco nem guarda data de escrita: declarar
   * `tamanho` nela devolveria a lista inteira, calado.
   */
  readonly criterios: readonly Criterio[];
}

const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', icon: 'table', criterios: ['nome', 'tamanho', 'data'] },
  { id: 'views', label: 'Views', icon: 'view', criterios: ['nome'] },
  { id: 'functions', label: 'Functions', icon: 'function', criterios: ['nome', 'dono'] },
  { id: 'procedures', label: 'Procedures', icon: 'procedure', criterios: ['nome', 'dono'] },
  // Spec 069 (T110). Sequence, type, foreign table e matview NÃO entram aqui:
  // o MySQL não tem nenhum dos quatro, e categoria sempre vazia é ruído.
  { id: 'events', label: 'Events', icon: 'event', criterios: ['nome', 'dono'] },
];


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
      // `database` é o que diz à interface que este nó pode abrir uma query
      // (spec 038). Quem declara é o driver; quem decide que isso merece um
      // botão é a interface — Artigo III.
      database: linha.SCHEMA_NAME,
      main: linha.SCHEMA_NAME.toLowerCase() === exibicao.main.trim().toLowerCase(),
    },
  }));
}


async function listarCategorias(conn: Connection, schema: string): Promise<TreeNode[]> {
  const [contagens = {}] = await query<Record<string, unknown>>(conn, CONTAGENS_SQL, [
    schema,
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
    meta: {
      schema,
      categoria: true,
      criterios: categoria.criterios,
      template: TEMPLATES_MYSQL[categoria.id],
    },
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

/**
 * As condições dos critérios da spec 069.
 *
 * A EXPRESSÃO vem do código e o valor vai ligado como `?`, sempre — a mesma
 * separação de `clausulaDeFiltro`, com mais de um critério.
 *
 * `COALESCE(UPDATE_TIME, CREATE_TIME)`: o InnoDB deixa `UPDATE_TIME` nulo em
 * tabela que ninguém escreveu desde o último restart. Sem o `COALESCE`, essas
 * tabelas sumiriam de qualquer filtro por data.
 */
function condicoesDe(
  categoria: Categoria,
  opcoes: OpcoesDeNavegacao | undefined,
  colunaDoDono: string | null
): { sql: string; params: unknown[] } {
  const partes: string[] = [];
  const params: unknown[] = [];
  const pode = (c: Criterio): boolean => categoria.criterios.includes(c);

  if (pode('dono') && colunaDoDono !== null && opcoes?.dono !== null && opcoes?.dono !== undefined) {
    partes.push(` AND ${colunaDoDono} = ?`);
    params.push(opcoes.dono);
  }
  if (pode('tamanho') && opcoes?.minBytes !== null && opcoes?.minBytes !== undefined) {
    partes.push(' AND (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) >= ?');
    params.push(opcoes.minBytes);
  }
  if (pode('data') && opcoes?.desde !== null && opcoes?.desde !== undefined) {
    partes.push(' AND COALESCE(UPDATE_TIME, CREATE_TIME) >= ?');
    params.push(opcoes.desde);
  }
  return { sql: partes.join(''), params };
}

async function listarObjetos(
  conn: Connection,
  schema: string,
  categoria: string,
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  const alvo = CATEGORIAS.find((c) => c.id === categoria);
  if (alvo === undefined) return [];
  const filtro = opcoes?.filtro;

  if (categoria === 'tables' || categoria === 'views') {
    const tipo = categoria === 'tables' ? 'BASE TABLE' : 'VIEW';
    const f = clausulaDeFiltro('TABLE_NAME', filtro);
    const c = condicoesDe(alvo, opcoes, null);
    const linhas = await query<{ TABLE_NAME: string; TABLE_ROWS: number | null }>(
      conn,
      `SELECT TABLE_NAME, TABLE_ROWS
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?${f.sql}${c.sql}
        ORDER BY TABLE_NAME`,
      [schema, tipo, ...f.params, ...c.params]
    );
    return linhas.map((linha) => ({
      id: linha.TABLE_NAME,
      label: linha.TABLE_NAME,
      icon: (categoria === 'tables' ? 'table' : 'view') as TreeNode['icon'],
      // TABLE_ROWS é estimativa no InnoDB — suficiente para orientar, não para contar.
      detail: linha.TABLE_ROWS === null ? undefined : contagem(linha.TABLE_ROWS),
      hasChildren: true,
      // O menu de tabela e o de view são diferentes: numa view não há o que
      // inserir nem o que esvaziar (spec 040, AC-7).
      actions: categoria === 'tables' ? ACOES_DE_TABELA : ACOES_DE_VIEW,
      meta: { schema, object: linha.TABLE_NAME, category: categoria },
    }));
  }

  if (categoria === 'events') {
    const f = clausulaDeFiltro('EVENT_NAME', filtro);
    const c = condicoesDe(alvo, opcoes, "SUBSTRING_INDEX(DEFINER, '@', 1)");
    const linhas = await query<{ EVENT_NAME: string; STATUS: string; QUANDO: string | null }>(
      conn,
      `SELECT EVENT_NAME, STATUS,
              CASE WHEN EVENT_TYPE = 'RECURRING'
                   THEN CONCAT('a cada ', INTERVAL_VALUE, ' ', INTERVAL_FIELD)
                   ELSE CAST(EXECUTE_AT AS CHAR) END AS QUANDO
         FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = ?${f.sql}${c.sql}
        ORDER BY EVENT_NAME`,
      [schema, ...f.params, ...c.params]
    );
    return linhas.map((linha) => ({
      id: linha.EVENT_NAME,
      label: linha.EVENT_NAME,
      icon: 'event' as const,
      // O estado importa: um evento DISABLED existe e não roda, e a árvore que
      // mostra os dois iguais faz procurar defeito no lugar errado.
      detail: [linha.QUANDO, linha.STATUS === 'ENABLED' ? null : linha.STATUS]
        .filter((p) => p !== null && p !== '')
        .join(' · ') || undefined,
      hasChildren: false,
      actions: [
        { id: 'ddl', label: 'Ver DDL' },
        { id: 'drop-event', label: 'Apagar (DROP)', danger: true },
      ],
      meta: { schema, object: linha.EVENT_NAME, category: categoria },
    }));
  }

  const tipo = categoria === 'functions' ? 'FUNCTION' : 'PROCEDURE';
  const f = clausulaDeFiltro('ROUTINE_NAME', filtro);
  const c = condicoesDe(alvo, opcoes, "SUBSTRING_INDEX(DEFINER, '@', 1)");
  const linhas = await query<{ ROUTINE_NAME: string; DTD_IDENTIFIER: string | null }>(
    conn,
    `SELECT ROUTINE_NAME, DTD_IDENTIFIER
       FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?${f.sql}${c.sql}
      ORDER BY ROUTINE_NAME`,
    [schema, tipo, ...f.params, ...c.params]
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
    COLUNAS_ARVORE_SQL,
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
  if (nodePath.length === 1) {
    const bancos = await listarBancos(conn, exibicao);
    const consulta = <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      query<T>(conn, sql, params === undefined ? [] : [...params]);
    // N003: sem permissão de ler `mysql.user`, o nó nem nasce.
    return (await segurancaDisponivel(consulta)) ? [...bancos, noDeSeguranca()] : bancos;
  }
  // `Security` é irmão dos bancos e não é um schema: desviado antes de tudo.
  if (nodePath[1] === SECURITY_ID) {
    const consulta = <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      query<T>(conn, sql, params === undefined ? [] : [...params]);
    return listarSeguranca(consulta, nodePath.slice(2), opcoes?.filtro);
  }
  if (nodePath.length === 2) return listarCategorias(conn, nodePath[1]);
  if (nodePath.length === 3) return listarObjetos(conn, nodePath[1], nodePath[2], opcoes);
  if (nodePath.length === 4 && (nodePath[2] === 'tables' || nodePath[2] === 'views')) {
    return listarColunas(conn, nodePath[1], nodePath[3]);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------


/**
 * Põe a conexão no database do vínculo antes de executar (spec 038).
 *
 * Uma conexão MySQL enxerga TODOS os schemas a que o usuário tem acesso — o que
 * torna `SELECT * FROM alunos` uma consulta ambígua: ela roda no schema em que a
 * conexão está, e responde de um banco qualquer sem dar erro. É a mesma
 * armadilha que o comando `db` do usuário resolve qualificando com `banco.tabela`.
 *
 * O `USE` é emitido a cada execução, e não uma vez na abertura, porque a conexão
 * é compartilhada entre abas: sem isto, abrir uma query de `servidor-2` mudaria o
 * banco da query de `servidor-4` que já estava aberta ao lado.
 */
async function usar(conn: Connection, database: string | undefined): Promise<void> {
  if (database === undefined || database === '') return;
  await query(conn, `USE ${quoteIdentifier(database, 'backtick')}`);
}


// ---------------------------------------------------------------------------
// Ações do menu de contexto
// ---------------------------------------------------------------------------


/**
 * As colunas de um objeto, no formato que os modelos de SQL pedem.
 *
 * Consulta própria, e não reaproveitando `listarColunas`: aquela monta nós de
 * árvore (rótulo, ícone, detalhe em texto), e reler `PK` de uma string montada
 * para desenhar seria adivinhar o que já se sabia.
 */
async function colunasParaModelo(
  conn: Connection,
  schema: string,
  objeto: string
): Promise<ColunaDeModelo[]> {
  const linhas = await query<{
    COLUMN_NAME: string;
    COLUMN_TYPE: string;
    COLUMN_KEY: string;
    EXTRA: string;
  }>(
    conn,
    COLUNAS_MODELO_SQL,
    [schema, objeto]
  );
  return linhas.map((linha) => ({
    nome: linha.COLUMN_NAME,
    tipo: linha.COLUMN_TYPE,
    chave: linha.COLUMN_KEY === 'PRI',
    autoIncremento: /auto_increment/i.test(linha.EXTRA ?? ''),
  }));
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

    case 'drop-event':
      return {
        kind: 'statement',
        title: objeto,
        content:
          `-- Apaga o evento ${alvo}.\n` +
          '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n' +
          `DROP EVENT ${alvo};\n`,
      };

    case 'ddl': {
      const comando =
        categoria === 'views'
          ? 'SHOW CREATE VIEW'
          : categoria === 'events'
            ? 'SHOW CREATE EVENT'
            : 'SHOW CREATE TABLE';
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

    default: {
      // Modelos e destrutivos (spec 040): o driver monta o SQL, a interface o
      // ABRE. Nada aqui executa.
      const colunas = await colunasParaModelo(conn, schema, objeto);
      return {
        kind: 'statement',
        title: objeto,
        content: modeloSql(request.actionId, { alvo, colunas, estilo: 'backtick' }),
      };
    }
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

  // O próprio id no servidor, pego AGORA: perguntar na hora de cancelar
  // exigiria a conexão livre, que é exatamente o que não se tem então.
  const [meu] = await query<{ id: number }>(conn, 'SELECT CONNECTION_ID() AS id');
  const meuId = Number(meu?.id ?? 0);
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
    readCell: async (request) => lerCelula(conn, request),
    cancelQuery: async () => {
      const comando = comandoDeCancelamento('mysql', meuId);
      // Conexão nova, curta, e sem `database`: ela existe para mandar uma linha
      // e morrer, e escolher schema custaria uma ida a mais ao servidor.
      const matadora = mysql.createConnection({
        ...(socket === '' ? { host: String(f.host), port: Number(f.port) } : { socketPath: socket }),
        user: String(f.user),
        password: f.password === undefined ? undefined : String(f.password),
        ssl: opcaoSsl(String(f.ssl_mode ?? 'DISABLED'), String(f.ssl_ca ?? '')),
        multipleStatements: false,
        connectTimeout: 15_000,
      });
      // Sem este ouvinte um erro de socket vira exceção não tratada e MATA O
      // PROCESSO — é a mesma armadilha documentada na conexão principal.
      matadora.on('error', () => undefined);
      try {
        await new Promise<void>((resolve, reject) => {
          matadora.connect((err) => (err ? reject(new Error(err.message)) : resolve()));
        });
        await query(matadora, comando.sql);
      } finally {
        matadora.destroy();
      }
    },
    readTable: async (request) => {
      exigirViva();
      await usar(conn, request.nodePath[1]);
      return lerTabela(conn, request, exibicao.rowLimit);
    },
    processList: async () => {
      exigirViva();
      const linhas = await query<{
        id: number; usuario: string | null; banco: string | null; comando: string | null;
        estado: string | null; segundos: number | null; sql_texto: string | null;
        eu_mesmo: number;
      }>(conn, PROCESSOS_SQL);
      return linhas.map((l) => ({
        id: String(l.id),
        usuario: l.usuario,
        banco: l.banco,
        comando: l.comando,
        estado: l.estado,
        segundos: l.segundos === null ? null : Number(l.segundos),
        sql: l.sql_texto,
        euMesmo: Number(l.eu_mesmo) === 1,
      }));
    },
    killProcess: async (id) => {
      exigirViva();
      // O id vem da lista que ESTE servidor devolveu, mas chega pela rede: se
      // não for um número, não vira SQL. `KILL` não aceita parâmetro.
      if (!/^\d+$/.test(id)) throw new Error(`Id de processo inválido: ${id}.`);
      await query(conn, `KILL ${id}`);
    },
    alterCapabilities: () => ({
      dialeto: DIALETOS.mysql.nome,
      operacoes: [...operacoesDisponiveis(DIALETOS.mysql)],
    }),
    alterStructure: async (request) => {
      const [, schema, , objeto] = request.nodePath;
      if (schema === undefined || objeto === undefined) {
        throw new Error('A alteração exige um objeto selecionado.');
      }
      return {
        titulo: objeto,
        sql: montarAlteracao(
          { alvo: qualificar(schema, objeto), dialeto: DIALETOS.mysql },
          request.operacao as never
        ),
      };
    },
    tableStructure: async (nodePath) => {
      exigirViva();
      await usar(conn, nodePath[1]);
      return estruturaDaTabela(conn, nodePath);
    },
    writeTable: async (request) => {
      exigirViva();
      await usar(conn, request.nodePath[1]);
      return escrever(conn, request);
    },
    execute: async (request) => {
      exigirViva();
      await usar(conn, request.database);
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
