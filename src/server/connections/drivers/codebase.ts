// Ler o catálogo do banco para o autocomplete (T053, spec 071).
//
// As consultas mudam por banco; a MONTAGEM não — ela fica aqui, e cada driver
// entrega as linhas cruas no mesmo formato. Três montagens do mesmo catálogo
// divergiriam num caso de canto.
//
// **Duas idas ao servidor, não uma por tabela.** Um banco com 300 tabelas não
// pode custar 300 consultas para o editor sugerir um nome.
import {
  MAX_OBJETOS_NO_CODEBASE,
  type Codebase,
  type EspecieDeObjeto,
  type ObjetoDoCodebase,
} from '../../../shared/sql/codebase';

export interface LinhaDeColunaDoCodebase {
  readonly objeto: string;
  readonly schema: string;
  readonly especie: EspecieDeObjeto;
  readonly coluna: string;
  readonly tipo: string;
}

export interface LinhaDeRotina {
  readonly nome: string;
  readonly schema: string;
  readonly especie: EspecieDeObjeto;
}

export function montarCodebase(
  database: string,
  colunas: readonly LinhaDeColunaDoCodebase[],
  rotinas: readonly LinhaDeRotina[],
  funcoes: readonly string[]
): Codebase {
  const porObjeto = new Map<string, ObjetoDoCodebase>();
  for (const linha of colunas) {
    const atual = porObjeto.get(linha.objeto);
    const coluna = { nome: linha.coluna, tipo: linha.tipo };
    if (atual === undefined) {
      if (porObjeto.size >= MAX_OBJETOS_NO_CODEBASE) break;
      porObjeto.set(linha.objeto, {
        nome: linha.objeto,
        especie: linha.especie,
        schema: linha.schema,
        colunas: [coluna],
      });
    } else {
      porObjeto.set(linha.objeto, { ...atual, colunas: [...atual.colunas, coluna] });
    }
  }

  const objetos = [
    ...porObjeto.values(),
    ...rotinas.map((r) => ({ nome: r.nome, especie: r.especie, schema: r.schema, colunas: [] })),
  ];

  return {
    database,
    objetos,
    // Sem repetir: o `pg_catalog` tem cada função uma vez por assinatura.
    funcoes: [...new Set(funcoes)].sort((a, b) => a.localeCompare(b)),
    lidoEm: Date.now(),
    cortado: porObjeto.size >= MAX_OBJETOS_NO_CODEBASE,
  };
}

/**
 * O que NÃO é código do usuário, e por isso não entra no autocomplete.
 *
 * Duas regras objetivas, e nenhuma delas é gosto meu:
 *
 * - **Partição não se escreve numa query.** Um `_hyper_1_15_chunk` do
 *   TimescaleDB, ou a partição de janeiro de uma tabela particionada, existem
 *   para o planejador — quem escreve SQL cita a tabela PAI. `pg_inherits` diz
 *   quem é filho, e diz com exatidão.
 * - **Objeto de EXTENSÃO é da extensão.** `pg_depend` com `deptype = 'e'`
 *   marca o que veio junto de um `CREATE EXTENSION`.
 *
 * Os números do banco dele mediram o quanto isso importa: no `nuntius`, das 107
 * relações só 32 são dele, e das 440 rotinas **nenhuma** — as outras 408 são
 * todas do TimescaleDB e do pgvector. Sem estes dois cortes, o autocomplete
 * oferecia 542 nomes, e os primeiros da lista eram pedaços internos.
 */
const SO_DO_USUARIO = `
     AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e')
`;

export const PG_COLUNAS_DO_CODEBASE = `
  SELECT c.relname AS objeto,
         n.nspname AS schema,
         CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'tabela' END AS especie,
         a.attname AS coluna,
         format_type(a.atttypid, a.atttypmod) AS tipo
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_toast%'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')${SO_DO_USUARIO}
   ORDER BY c.relname, a.attnum
`;

export const PG_ROTINAS_DO_CODEBASE = `
  SELECT DISTINCT p.proname AS nome, n.nspname AS schema,
         CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS especie
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
   ORDER BY p.proname
`;

/**
 * As funções do PRÓPRIO banco.
 *
 * O PostgreSQL as tem no catálogo, como qualquer outra — é a única das três
 * bases em que esta lista é a verdade do servidor, e não uma tabela escrita à
 * mão. Só as que se escrevem como função: operador não entra.
 */
export const PG_FUNCOES_INTERNAS = `
  SELECT DISTINCT p.proname AS nome
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pg_catalog' AND p.proname !~ '^(pg_|_)'
   ORDER BY p.proname
`;

export const MYSQL_COLUNAS_DO_CODEBASE = `
  SELECT c.TABLE_NAME AS objeto, c.TABLE_SCHEMA AS \`schema\`,
         CASE WHEN t.TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'tabela' END AS especie,
         c.COLUMN_NAME AS coluna, c.COLUMN_TYPE AS tipo
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
   WHERE c.TABLE_SCHEMA = ?
   ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
`;

export const MYSQL_ROTINAS_DO_CODEBASE = `
  SELECT ROUTINE_NAME AS nome, ROUTINE_SCHEMA AS \`schema\`,
         LOWER(ROUTINE_TYPE) AS especie
    FROM information_schema.ROUTINES
   WHERE ROUTINE_SCHEMA = ?
   ORDER BY ROUTINE_NAME
`;
