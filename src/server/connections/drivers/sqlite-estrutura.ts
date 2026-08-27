// A estrutura de uma tabela SQLite (spec 045).
//
// O SQLite responde quase tudo por `PRAGMA`, e guarda o DDL original no
// `sqlite_master` — então aqui não há reconstrução, ao contrário do PostgreSQL.
//
// Gatilho e checagem não têm pragma: o primeiro mora inteiro no `sqlite_master`
// e a segunda dentro do texto do `CREATE TABLE`. A spec 069 (T063) passou a
// interpretá-los — a varredura é pura e vive em `shared/sql/sqlite-ddl.ts`.
//
// O que a varredura não conseguir ler continua voltando como "não sei", e não
// como lista vazia: são coisas diferentes, e a spec 045 já paga esse preço.
import type { DatabaseSync } from 'node:sqlite';
import type {
  ChaveEstrangeira,
  ChecagemDaTabela,
  ColunaDetalhada,
  GatilhoDaTabela,
  IndiceDaTabela,
  ListaOuNaoSei,
  TableStructure,
} from '../types';
import { quoteIdentifier } from './sql-base';
import { lerChecagens, lerGatilho } from '../../../shared/sql/sqlite-ddl';

const quote = (nome: string): string => quoteIdentifier(nome, 'double');

/** `varchar(255)` dá 255; `INTEGER` dá `null`. */
function tamanhoDoTipo(tipo: string): number | null {
  const casamento = /\((\d+)/.exec(tipo);
  return casamento === null ? null : Number(casamento[1]);
}

export function estruturaDaTabela(db: DatabaseSync, nodePath: readonly string[]): TableStructure {
  const objeto = nodePath[2];
  if (objeto === undefined) throw new Error('A estrutura exige um objeto selecionado.');

  const mestre = db
    .prepare('SELECT type, sql FROM sqlite_master WHERE name = ?')
    .get(objeto) as { type?: string; sql?: string | null } | undefined;
  if (mestre === undefined) throw new Error(`Objeto não encontrado: ${objeto}`);
  const ehView = mestre.type === 'view';

  const info = db.prepare(`PRAGMA table_info(${quote(objeto)})`).all() as Array<{
    name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
  }>;

  const indicesBrutos = db.prepare(`PRAGMA index_list(${quote(objeto)})`).all() as Array<{
    name: string; unique: number; origin: string;
  }>;
  const indices: IndiceDaTabela[] = indicesBrutos.map((i) => {
    const colunas = (
      db.prepare(`PRAGMA index_info(${quote(i.name)})`).all() as Array<{ name: string | null }>
    )
      .map((c) => c.name)
      .filter((n): n is string => n !== null);
    return {
      nome: i.name,
      colunas,
      unico: i.unique === 1,
      // `origin` diz de onde o índice veio: `pk`, `u` (UNIQUE) ou `c` (CREATE
      // INDEX). É mais informativo que o "tipo" que outros bancos dão.
      tipo: i.origin === 'pk' ? 'PRIMARY KEY' : i.origin === 'u' ? 'UNIQUE' : 'INDEX',
    };
  });

  // Uma coluna é única quando há índice único só dela.
  const unicas = new Set(
    indices.filter((i) => i.unico && i.colunas.length === 1).map((i) => i.colunas[0])
  );

  const chaves = info.filter((c) => c.pk > 0);
  const colunas: ColunaDetalhada[] = info.map((c) => ({
    name: c.name,
    type: c.type || 'ANY',
    tamanho: tamanhoDoTipo(c.type ?? ''),
    // O SQLite não guarda comentário de coluna.
    comentario: null,
    padrao: c.dflt_value,
    obrigatoria: c.notnull > 0,
    chave: c.pk > 0,
    unica: unicas.has(c.name),
    // `INTEGER PRIMARY KEY` é apelido do `rowid` — o auto-incremento do SQLite.
    autoIncremento: c.pk > 0 && chaves.length === 1 && /^integer$/i.test(c.type ?? ''),
  }));

  const fks = db.prepare(`PRAGMA foreign_key_list(${quote(objeto)})`).all() as Array<{
    id: number; table: string; from: string; to: string | null;
    on_update: string; on_delete: string;
  }>;
  const chavesEstrangeiras: ChaveEstrangeira[] = fks.map((f) => ({
    // O SQLite não nomeia chave estrangeira: o `id` do pragma é o que há.
    nome: `fk_${f.id}`,
    coluna: f.from,
    tabelaReferenciada: f.table,
    // `to` vem nulo quando a referência é à chave primária implícita.
    colunaReferenciada: f.to ?? '(chave primária)',
    aoAtualizar: f.on_update,
    aoApagar: f.on_delete,
  }));

  // Os gatilhos DESTA tabela, do `sqlite_master`. Um cujo texto a varredura não
  // reconheça derruba a lista inteira para `naoSei`: listar três de quatro e
  // não dizer nada do quarto seria a tela afirmando o que não sabe.
  const gatilhos = lerGatilhosDaTabela(db, objeto);
  const checagens: ListaOuNaoSei<ChecagemDaTabela> =
    mestre.sql === null || mestre.sql === undefined
      ? { naoSei: 'O SQLite não guardou o DDL desta tabela.' }
      : lerChecagens(mestre.sql);

  return {
    nome: objeto,
    // Comentário, motor e colação não existem no SQLite.
    comentario: null,
    motor: null,
    colacao: null,
    ehView,
    ddl: mestre.sql === null || mestre.sql === undefined ? '' : `${mestre.sql};`,
    colunas,
    chavesEstrangeiras: { itens: chavesEstrangeiras },
    indices: { itens: indices },
    gatilhos,
    checagens,
  };
}

/**
 * Os gatilhos de uma tabela, lidos do texto que o SQLite guardou.
 *
 * `tbl_name` é o que amarra o gatilho à tabela — o nome dentro do `ON` seria a
 * segunda fonte da mesma verdade, e as duas divergiriam num `ALTER TABLE
 * RENAME`, que reescreve o texto mas não o `tbl_name`.
 */
function lerGatilhosDaTabela(db: DatabaseSync, objeto: string): ListaOuNaoSei<GatilhoDaTabela> {
  const linhas = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
    .all(objeto) as Array<{ name: string; sql: string | null }>;

  const itens: GatilhoDaTabela[] = [];
  for (const linha of linhas) {
    const lido = linha.sql === null ? null : lerGatilho(linha.sql);
    if (lido === null) {
      return {
        naoSei:
          `A IDE não conseguiu interpretar o texto do gatilho "${linha.name}". ` +
          'Veja o DDL para o texto exato.',
      };
    }
    itens.push({
      nome: lido.nome,
      momento: lido.momento,
      evento: lido.evento,
      orientacao: lido.orientacao,
      corpo: lido.corpo,
    });
  }
  return { itens };
}
