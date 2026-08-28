// Driver SQLite, sobre o módulo nativo `node:sqlite`.
//
// Escolhido no lugar de better-sqlite3 para não exigir compilação nativa. A API
// é síncrona: não há timeout de query aplicável (o banco é um arquivo local), e
// `readOnly` é imposto pelo próprio SQLite, não por filtro de texto no SQL.
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { ICONES_DE_SERVICO } from '../../../shared/icons';
import {
  APELIDO_DA_CONTAGEM,
  montarConsultaDeTabela,
  normalizarPedidoDeTabela,
} from './tabela';
import { DEFAULT_ROW_LIMIT } from './sql-base';
import { escreverNaTabela } from './transacao';
import { cortarParaOVisor, montarLeituraDeCelula } from './celula';
import { paraCelulaCrua } from './sql-base';
import type { CellRequest, CellResult } from '../../../shared/contracts';
import { estruturaDaTabela } from './sqlite-estrutura';
import { DIALETOS, montarAlteracao, operacoesDisponiveis } from './alterar';
import {
  ACOES_DE_TABELA_SQLITE,
  ACOES_DE_VIEW,
  modeloSql,
  type ColunaDeModelo,
} from './modelos';
import { TEMPLATES_SQLITE } from '../../../shared/tree/templates';
import { montarDiagrama, type LinhaDeColuna, type LinhaDeFk } from './er';
import { montarCodebase, type LinhaDeColunaDoCodebase } from './codebase';
import type { Codebase } from '../types';
import type {
  OpcoesDeNavegacao,
  ActionRequest,
  ActionResult,
  CellValue,
  ColumnInfo,
  Driver,
  ExecuteRequest,
  QueryResult,
  TableColumn,
  TablePage,
  TableRequest,
  TableWriteRequest,
  TableWriteResult,
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
    // Spec 040. O índice fica com o menu curto: não há o que selecionar nem o
    // que esvaziar num índice.
    actions:
      categoria.sqliteType === 'table'
        ? ACOES_DE_TABELA_SQLITE
        : categoria.sqliteType === 'view'
          ? ACOES_DE_VIEW
          : [{ id: 'ddl', label: 'Ver DDL' }],
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
        // O arquivo É o banco: um database só, e ele se chama `main` no próprio
        // SQLite. Declarado para a interface poder abrir query aqui também.
        // O arquivo inteiro é o schema: o diagrama sai daqui (T064).
        meta: { file, database: 'main', diagramaEr: true },
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
      // O SQLite não tem dono, não guarda tamanho por objeto e não guarda
      // data: o único critério que ele sabe responder é o nome (T112).
      meta: { categoria: true, criterios: ['nome'], template: TEMPLATES_SQLITE[categoria.id] },
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

function executar(
  db: DatabaseSync,
  request: ExecuteRequest,
  params: readonly string[] = []
): QueryResult {
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
  // Linhas a pular (T056), descartadas do próprio iterador.
  const pular = Math.max(0, Math.trunc(request.offset ?? 0));
  let puladas = 0;
  for (const linha of stmt.iterate(...params)) {
    if (puladas < pular) {
      puladas += 1;
      continue;
    }
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

/**
 * Uma página da tabela (spec 041).
 *
 * O SQLite conta rápido — `COUNT(*)` usa o índice do `rowid` — então aqui não
 * há estimativa: sempre o total de verdade.
 */
function lerTabela(db: DatabaseSync, request: TableRequest, limitePadrao: number): TablePage {
  const objeto = request.nodePath[2];
  if (objeto === undefined) throw new Error('A aba de tabela exige um objeto selecionado.');

  const info = db.prepare(`PRAGMA table_info(${quote(objeto)})`).all() as Array<{
    name: string; type: string; notnull: number; pk: number;
  }>;
  if (info.length === 0) throw new Error(`Tabela não encontrada: ${objeto}`);
  const colunas: TableColumn[] = info.map((c) => ({
    name: c.name,
    type: c.type || 'ANY',
    chave: c.pk > 0,
    obrigatoria: c.notnull > 0,
  }));

  const pedido = normalizarPedidoDeTabela(
    { ...request, porPagina: request.porPagina || limitePadrao },
    colunas.map((c) => c.name)
  );
  const { sql, contagem, params } = montarConsultaDeTabela(
    { alvo: quote(objeto), colunas: colunas.map((c) => c.name), estilo: 'double' },
    pedido
  );

  const linha = db.prepare(contagem).get(...params) as Record<string, unknown> | undefined;
  // Pelo APELIDO, e não por posição: ler por posição foi o que fez o SQLite
  // disfarçar o defeito do MySQL, em que a contagem vinha sem nome nenhum.
  const total = Number(linha?.[APELIDO_DA_CONTAGEM] ?? 0);

  return {
    resultado: executar(db, { statement: sql, rowLimit: pedido.porPagina }, params),
    columns: colunas,
    sql,
    total,
    totalEstimado: null,
  };
}

/** O valor inteiro de uma célula (spec 062, fase D). Ver `celula.ts`. */
function lerCelula(db: DatabaseSync, request: CellRequest): CellResult {
  const objeto = request.nodePath[2];
  if (objeto === undefined) throw new Error('Ver o valor inteiro exige um objeto selecionado.');
  const info = db.prepare(`PRAGMA table_info(${quote(objeto)})`).all() as Array<{
    name: string; pk: number;
  }>;
  if (info.length === 0) throw new Error(`Tabela não encontrada: ${objeto}`);

  const comando = montarLeituraDeCelula(
    {
      alvo: quote(objeto),
      colunas: info.map((c) => ({ name: c.name, chave: c.pk > 0 })),
      estilo: 'double',
    },
    request.coluna,
    request.chave
  );

  const linha = db.prepare(comando.sql).get(...(comando.params as never[])) as
    | Record<string, unknown>
    | undefined;
  if (linha === undefined) throw new Error('Esta linha não existe mais no banco.');
  return cortarParaOVisor(paraCelulaCrua(linha[request.coluna]));
}

/** Escrever pela grade (spec 044), em uma transação. */
async function escrever(
  db: DatabaseSync,
  request: TableWriteRequest
): Promise<TableWriteResult> {
  const objeto = request.nodePath[2];
  if (objeto === undefined) throw new Error('A escrita exige um objeto selecionado.');
  const info = db.prepare(`PRAGMA table_info(${quote(objeto)})`).all() as Array<{
    name: string; pk: number;
  }>;
  if (info.length === 0) throw new Error(`Tabela não encontrada: ${objeto}`);

  return escreverNaTabela(
    {
      alvo: quote(objeto),
      colunas: info.map((c) => ({ name: c.name, chave: c.pk > 0 })),
      estilo: 'double',
    },
    request,
    {
      comecar: async () => { db.exec('BEGIN'); },
      confirmar: async () => { db.exec('COMMIT'); },
      desfazer: async () => { db.exec('ROLLBACK'); },
      rodar: async (sql, params) => Number(db.prepare(sql).run(...(params as never[])).changes),
    }
  );
}

/** nodePath de um objeto é [main, categoria, objeto]. */
function acao(db: DatabaseSync, request: ActionRequest): ActionResult {
  const objeto = request.nodePath[2];
  if (objeto === undefined) throw new Error('Ação exige um objeto selecionado.');

  switch (request.actionId) {
    case 'select':
      return { kind: 'statement', title: objeto, content: `SELECT * FROM ${quote(objeto)} LIMIT 100;` };

    case 'template-select':
    case 'template-insert':
    case 'template-update':
    case 'template-delete':
    case 'copiar':
    case 'esvaziar':
    case 'drop':
    case 'drop-view': {
      // `PRAGMA table_info` marca a chave, mas não o auto-incremento: no SQLite
      // ele é `INTEGER PRIMARY KEY` (com ou sem `AUTOINCREMENT`), que é um
      // apelido do `rowid`. Reconhecer pelo tipo é o que o próprio motor faz.
      const linhas = db.prepare(`PRAGMA table_info(${quote(objeto)})`).all() as Array<{
        name: string; type: string; pk: number;
      }>;
      const soUmaChave = linhas.filter((c) => c.pk > 0).length === 1;
      const colunas: ColunaDeModelo[] = linhas.map((c) => ({
        nome: c.name,
        tipo: c.type || 'ANY',
        chave: c.pk > 0,
        autoIncremento: c.pk > 0 && soUmaChave && /^integer$/i.test(c.type ?? ''),
      }));
      return {
        kind: 'statement',
        title: objeto,
        content: modeloSql(request.actionId, {
          alvo: quote(objeto),
          colunas,
          estilo: 'double',
        }),
      };
    }

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
  /** O catálogo (T053). Vive na SESSÃO; fechar o arquivo o descarta. */
  const catalogos = new Map<string, Codebase>();
  const file = String(config.fields.file ?? '');
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo SQLite não encontrado: ${file}`);
  }

  // O SQLite recusa a escrita no nível do banco — não há filtro de SQL aqui.
  const db = new DatabaseSync(file, { readOnly: config.readOnly });

  return {
    kind: 'sql',
    children: async (nodePath, opcoes) => navegar(db, file, nodePath, opcoes),
    readTable: async (request) => lerTabela(db, request, DEFAULT_ROW_LIMIT),
    readCell: async (request) => lerCelula(db, request),
    writeTable: (request) => escrever(db, request),
    tableStructure: async (nodePath) => estruturaDaTabela(db, nodePath),
    // O SQLite é um arquivo, não um servidor: não há processo alheio para
    // listar nem para matar. `null` diz isso; lista vazia diria outra coisa.
    processList: async () => null,
    /**
     * O catálogo, para o autocomplete (T053).
     *
     * As funções internas vêm do PRÓPRIO SQLite: `PRAGMA function_list` existe
     * desde a 3.30, e é a verdade do motor — não uma lista escrita à mão como a
     * do MySQL. Se o pragma não responder, a lista fica vazia: sugerir função
     * que aquele build não tem seria pior que não sugerir.
     */
    codebase: async () => {
      const guardado = catalogos.get('main');
      if (guardado !== undefined) return guardado;

      const objetos = db
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view')" +
            " AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string; type: string }>;

      const colunas: LinhaDeColunaDoCodebase[] = [];
      for (const o of objetos) {
        const info = db
          .prepare(`PRAGMA table_info(${quoteIdentifier(o.name, 'double')})`)
          .all() as Array<{ name: string; type: string }>;
        for (const c of info) {
          colunas.push({
            objeto: o.name,
            schema: '',
            especie: o.type === 'view' ? 'view' : 'tabela',
            coluna: c.name,
            tipo: c.type || 'ANY',
          });
        }
      }

      let funcoes: string[] = [];
      try {
        funcoes = (db.prepare('PRAGMA function_list').all() as Array<{ name: string }>)
          .map((f) => f.name);
      } catch {
        // Build sem o pragma: fica sem função, e não com uma lista inventada.
      }

      const catalogo = montarCodebase(config.label, colunas, [], funcoes);
      catalogos.set('main', catalogo);
      return catalogo;
    },
    /**
     * O diagrama ER do arquivo inteiro (T064).
     *
     * Aqui é N+1 de propósito: o SQLite não tem `information_schema`, e o
     * `PRAGMA` responde uma tabela por vez. O banco é um ARQUIVO LOCAL e o
     * driver é síncrono — as N chamadas custam microssegundos, e não uma ida à
     * rede cada. Nos outros dois isso seria inaceitável, e por isso lá são duas.
     */
    erDiagram: async () => {
      const tabelas = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>;

      const colunas: LinhaDeColuna[] = [];
      const fks: LinhaDeFk[] = [];
      for (const { name } of tabelas) {
        const alvo = quoteIdentifier(name, 'double');
        const info = db.prepare(`PRAGMA table_info(${alvo})`).all() as Array<{
          name: string; type: string; pk: number; notnull: number;
        }>;
        for (const c of info) {
          colunas.push({ tabela: name, coluna: c.name, tipo: c.type || 'ANY', pk: c.pk > 0 });
        }
        const lista = db.prepare(`PRAGMA foreign_key_list(${alvo})`).all() as Array<{
          table: string; from: string;
        }>;
        for (const f of lista) {
          const coluna = info.find((c) => c.name === f.from);
          fks.push({
            de: name,
            para: f.table,
            coluna: f.from,
            obrigatoria: (coluna?.notnull ?? 0) > 0,
          });
        }
      }
      return montarDiagrama(config.label, colunas, fks);
    },
    alterCapabilities: () => ({
      dialeto: DIALETOS.sqlite.nome,
      operacoes: [...operacoesDisponiveis(DIALETOS.sqlite)],
    }),
    alterStructure: async (request) => {
      const objeto = request.nodePath[2];
      if (objeto === undefined) throw new Error('A alteração exige um objeto selecionado.');
      return {
        titulo: objeto,
        sql: montarAlteracao(
          { alvo: quote(objeto), dialeto: DIALETOS.sqlite },
          request.operacao as never
        ),
      };
    },
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
