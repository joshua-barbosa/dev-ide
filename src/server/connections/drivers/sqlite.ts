// Driver SQLite, sobre o módulo nativo `node:sqlite`.
//
// Escolhido no lugar de better-sqlite3 para não exigir compilação nativa. A API
// é síncrona: não há timeout de query aplicável (o banco é um arquivo local), e
// `readOnly` é imposto pelo próprio SQLite, não por filtro de texto no SQL.
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { ICONES_DE_SERVICO } from '../../../shared/icons';
import { TEMPLATES_SQLITE } from '../../../shared/tree/templates';
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
import { formatCell, quoteIdentifier, resolveRowLimit } from './sql-base';

const ROOT_ID = 'main';

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly sqliteType: string;
  readonly icon: TreeNode['icon'];
}

const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', sqliteType: 'table', icon: 'table' },
  { id: 'views', label: 'Views', sqliteType: 'view', icon: 'view' },
  { id: 'indexes', label: 'Indexes', sqliteType: 'index', icon: 'index' },
];

function quote(name: string): string {
  return quoteIdentifier(name, 'double');
}

/** Objetos internos do SQLite (sqlite_sequence etc.) não interessam na árvore. */
const OBJETOS_SQL = `
  SELECT name FROM sqlite_master
  WHERE type = ? AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`;

/**
 * Mesma consulta, com o filtro do usuário.
 *
 * O padrão entra como TERCEIRO parâmetro ligado — nunca no texto. Um padrão com
 * aspas ou ponto e vírgula vira busca sem resultado, e não sintaxe.
 */
const OBJETOS_FILTRADOS_SQL = `
  SELECT name FROM sqlite_master
  WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name LIKE ?
  ORDER BY name
`;

function contarLinhas(db: DatabaseSync, tabela: string): string | undefined {
  try {
    const row = db.prepare(`SELECT count(*) AS n FROM ${quote(tabela)}`).get() as { n: number } | undefined;
    return row === undefined ? undefined : String(row.n);
  } catch {
    // View quebrada ou tabela virtual sem count: a árvore continua útil sem o número.
    return undefined;
  }
}

function colunasDe(db: DatabaseSync, objeto: string): TreeNode[] {
  const linhas = db.prepare(`PRAGMA table_info(${quote(objeto)})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;

  return linhas.map((coluna) => {
    const marcas = [coluna.type || 'ANY'];
    if (coluna.pk > 0) marcas.push('PK');
    if (coluna.notnull > 0) marcas.push('NOT NULL');
    return {
      id: coluna.name,
      label: coluna.name,
      icon: 'column' as const,
      detail: marcas.join(' · '),
      hasChildren: false,
      meta: { object: objeto, column: coluna.name },
    };
  });
}

function listarObjetos(
  db: DatabaseSync,
  categoria: Categoria,
  filtro?: string | null
): TreeNode[] {
  const linhas = (
    filtro === null || filtro === undefined
      ? db.prepare(OBJETOS_SQL).all(categoria.sqliteType)
      : db.prepare(OBJETOS_FILTRADOS_SQL).all(categoria.sqliteType, filtro)
  ) as Array<{ name: string }>;
  return linhas.map((linha) => ({
    id: linha.name,
    label: linha.name,
    icon: categoria.icon,
    detail: categoria.sqliteType === 'index' ? undefined : contarLinhas(db, linha.name),
    hasChildren: categoria.sqliteType !== 'index',
    actions:
      categoria.sqliteType === 'table'
        ? [
            { id: 'select', label: 'Abrir Query' },
            { id: 'ddl', label: 'Ver DDL' },
            { id: 'count', label: 'Contar linhas (exato)' },
          ]
        : [
            { id: 'select', label: 'Abrir Query' },
            { id: 'ddl', label: 'Ver DDL' },
          ],
    meta: { object: linha.name, category: categoria.id },
  }));
}

function navegar(
  db: DatabaseSync,
  file: string,
  nodePath: readonly string[],
  opcoes?: OpcoesDeNavegacao
): TreeNode[] {
  if (nodePath.length === 0) {
    return [
      {
        id: ROOT_ID,
        label: path.basename(file),
        icon: 'database',
        detail: tamanhoLegivel(file),
        hasChildren: true,
        meta: { file },
      },
    ];
  }

  if (nodePath.length === 1 && nodePath[0] === ROOT_ID) {
    return CATEGORIAS.map((categoria) => ({
      id: categoria.id,
      label: categoria.label,
      icon: categoria.icon,
      detail: String(
        (db.prepare(OBJETOS_SQL).all(categoria.sqliteType) as unknown[]).length
      ),
      hasChildren: true,
      meta: { categoria: true, template: TEMPLATES_SQLITE[categoria.id] },
    }));
  }

  if (nodePath.length === 2 && nodePath[0] === ROOT_ID) {
    const categoria = CATEGORIAS.find((item) => item.id === nodePath[1]);
    return categoria === undefined ? [] : listarObjetos(db, categoria, opcoes?.filtro);
  }

  if (nodePath.length === 3 && nodePath[0] === ROOT_ID && nodePath[1] !== 'indexes') {
    return colunasDe(db, nodePath[2]);
  }

  return [];
}

function tamanhoLegivel(file: string): string | undefined {
  try {
    const bytes = fs.statSync(file).size;
    if (bytes < 1024) return `${bytes}B`;
    const unidades = ['K', 'M', 'G', 'T'];
    let valor = bytes / 1024;
    let i = 0;
    while (valor >= 1024 && i < unidades.length - 1) {
      valor /= 1024;
      i += 1;
    }
    return `${valor.toFixed(1)}${unidades[i]}`;
  } catch {
    return undefined;
  }
}

function executar(db: DatabaseSync, request: ExecuteRequest): QueryResult {
  const limite = resolveRowLimit(request.rowLimit);
  const inicio = Date.now();
  const stmt = db.prepare(request.statement);

  let colunas: ColumnInfo[] = [];
  try {
    colunas = stmt.columns().map((coluna) => ({
      name: coluna.name,
      type: coluna.type ?? undefined,
    }));
  } catch {
    colunas = [];
  }

  // Sem colunas declaradas, o comando não devolve linhas (INSERT/UPDATE/DDL).
  if (colunas.length === 0) {
    const info = stmt.run();
    const afetadas = Number(info.changes);
    return {
      columns: [],
      rows: [],
      rowCount: afetadas,
      durationMs: Date.now() - inicio,
      truncated: false,
      message: `${afetadas} linha(s) afetada(s).`,
    };
  }

  // Puxa uma linha a mais que o limite: é ela que revela o truncamento.
  const rows: CellValue[][] = [];
  let truncated = false;
  for (const linha of stmt.iterate()) {
    if (rows.length === limite) {
      truncated = true;
      break;
    }
    const registro = linha as Record<string, unknown>;
    rows.push(colunas.map((coluna) => formatCell(registro[coluna.name])));
  }

  return {
    columns: colunas,
    rows,
    rowCount: rows.length,
    durationMs: Date.now() - inicio,
    truncated,
  };
}

/** nodePath de um objeto é [main, categoria, objeto]. */
function acao(db: DatabaseSync, request: ActionRequest): ActionResult {
  const objeto = request.nodePath[2];
  if (objeto === undefined) throw new Error('Ação exige um objeto selecionado.');

  switch (request.actionId) {
    case 'select':
      return { kind: 'statement', title: objeto, content: `SELECT * FROM ${quote(objeto)} LIMIT 100;` };

    case 'ddl': {
      // O SQLite guarda o DDL original, então aqui não há reconstrução.
      const linha = db
        .prepare('SELECT sql FROM sqlite_master WHERE name = ?')
        .get(objeto) as { sql: string | null } | undefined;
      if (linha === undefined || linha.sql === null) {
        throw new Error(`Não foi possível ler o DDL de ${objeto}.`);
      }
      return { kind: 'text', title: `${objeto} (DDL)`, content: linha.sql + ';' };
    }

    case 'count': {
      const linha = db.prepare(`SELECT count(*) AS n FROM ${quote(objeto)}`).get() as { n: number };
      return { kind: 'text', title: `${objeto} (total)`, content: `-- ${objeto}\n-- ${linha.n} linha(s)\n` };
    }

    default:
      throw new Error(`Ação desconhecida: ${request.actionId}`);
  }
}

async function connect(config: ResolvedConfig): Promise<Session> {
  const file = String(config.fields.file ?? '');
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo SQLite não encontrado: ${file}`);
  }

  // O SQLite recusa a escrita no nível do banco — não há filtro de SQL aqui.
  const db = new DatabaseSync(file, { readOnly: config.readOnly });

  return {
    kind: 'sql',
    children: async (nodePath, opcoes) => navegar(db, file, nodePath, opcoes),
    execute: async (request) => executar(db, request),
    runAction: async (request) => acao(db, request),
    close: async () => {
      db.close();
    },
  };
}

export const sqliteDriver: Driver = {
  type: 'sqlite',
  label: 'SQLite',
  kind: 'sql',
  panel: 'database',
  icon: ICONES_DE_SERVICO.sqlite,
  fields: [
    {
      name: 'file',
      label: 'Arquivo',
      type: 'path',
      required: true,
      placeholder: '/caminho/do/banco.db',
      help: 'Caminho do arquivo .db/.sqlite na máquina local.',
    },
  ],
  connect,
};
