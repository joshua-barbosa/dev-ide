// Os dados do diagrama ER (T064, spec 069).
//
// As consultas mudam por banco; a MONTAGEM não. Ela fica aqui, e cada driver
// entrega as duas listas cruas — colunas e chaves estrangeiras — no mesmo
// formato. Três montagens do mesmo diagrama divergiriam num caso de canto.
//
// **Duas idas ao servidor, não N+1.** Perguntar as colunas tabela por tabela
// seriam 40 consultas para desenhar uma tela.
import {
  MAX_TABELAS_NO_DIAGRAMA,
  type DiagramaER,
  type RelacaoDoDiagrama,
  type TabelaDoDiagrama,
} from '../../../shared/sql/diagrama-er';

export interface LinhaDeColuna {
  readonly tabela: string;
  readonly coluna: string;
  readonly tipo: string;
  readonly pk: boolean;
}

export interface LinhaDeFk {
  readonly de: string;
  readonly para: string;
  readonly coluna: string;
  readonly obrigatoria: boolean;
}

/**
 * Junta as duas listas num diagrama, com o teto aplicado.
 *
 * O corte é pelas PRIMEIRAS em ordem alfabética, e não pelas "mais
 * importantes": qualquer critério de importância seria palpite meu sobre o
 * schema dele. Alfabético é arbitrário e previsível — e quantas ficaram de fora
 * vai escrito.
 */
export function montarDiagrama(
  titulo: string,
  colunas: readonly LinhaDeColuna[],
  fks: readonly LinhaDeFk[]
): DiagramaER {
  const porTabela = new Map<string, TabelaDoDiagrama>();
  for (const linha of colunas) {
    const atual = porTabela.get(linha.tabela);
    const coluna = { nome: linha.coluna, tipo: linha.tipo, chave: linha.pk };
    if (atual === undefined) {
      porTabela.set(linha.tabela, { nome: linha.tabela, colunas: [coluna] });
    } else {
      porTabela.set(linha.tabela, { ...atual, colunas: [...atual.colunas, coluna] });
    }
  }

  const todas = [...porTabela.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const tabelas = todas.slice(0, MAX_TABELAS_NO_DIAGRAMA);
  const dentro = new Set(tabelas.map((t) => t.nome));

  // Relação com uma ponta fora do teto não entra: o Mermaid criaria a entidade
  // que falta, vazia, e o diagrama passaria a mostrar tabela que ele mesmo
  // disse ter cortado.
  const relacoes: RelacaoDoDiagrama[] = fks
    .filter((f) => dentro.has(f.de) && dentro.has(f.para))
    .map((f) => ({ de: f.de, para: f.para, coluna: f.coluna, obrigatoria: f.obrigatoria }));

  return { titulo, tabelas, relacoes, cortadas: todas.length - tabelas.length };
}

export const PG_COLUNAS_DO_ER = `
  SELECT c.relname AS tabela,
         a.attname AS coluna,
         format_type(a.atttypid, a.atttypmod) AS tipo,
         COALESCE(i.indisprimary, false) AS pk
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_index i ON i.indrelid = c.oid AND a.attnum = ANY(i.indkey) AND i.indisprimary
   WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
   ORDER BY c.relname, a.attnum
`;

export const PG_FKS_DO_ER = `
  SELECT c.relname AS de, cl.relname AS para, a.attname AS coluna, a.attnotnull AS obrigatoria
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class cl ON cl.oid = con.confrelid
    JOIN LATERAL unnest(con.conkey) AS u(k) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.k
   WHERE n.nspname = $1 AND con.contype = 'f'
   ORDER BY con.conname
`;

export const MYSQL_COLUNAS_DO_ER = `
  SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, COLUMN_TYPE AS tipo,
         (COLUMN_KEY = 'PRI') AS pk
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ?
     AND TABLE_NAME IN (SELECT TABLE_NAME FROM information_schema.TABLES
                         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE')
   ORDER BY TABLE_NAME, ORDINAL_POSITION
`;

/**
 * As chaves estrangeiras do schema.
 *
 * `IS_NULLABLE` vem de outra tabela do `information_schema` — é ele que diz se
 * a relação é obrigatória, e sem o `JOIN` toda relação viraria opcional.
 */
export const MYSQL_FKS_DO_ER = `
  SELECT k.TABLE_NAME AS de, k.REFERENCED_TABLE_NAME AS para, k.COLUMN_NAME AS coluna,
         (c.IS_NULLABLE = 'NO') AS obrigatoria
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.COLUMNS c
      ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME
     AND c.COLUMN_NAME = k.COLUMN_NAME
   WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
   ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
`;
