// As consultas ao catálogo do PostgreSQL.
//
// Saíram de `postgres.ts` quando ele passou do teto de 800 linhas do Artigo IV —
// o portão da spec 028 o pegou em 804, ao ganhar a aba de tabela (spec 041).
//
// O corte foi aqui porque é o bloco mais coeso do arquivo: nenhuma destas
// depende de estado, e todas respondem à mesma pergunta — "o que existe neste
// banco?". O `{FILTRO}` que algumas trazem é substituído por quem chama, com o
// padrão do usuário como PARÂMETRO, nunca concatenado no texto.

/**
 * A estimativa de linhas de uma tabela, do catálogo.
 *
 * `reltuples` é atualizado por `ANALYZE` e pelo autovacuum: não é exato, e por
 * isso a aba de tabela só o usa quando diz que o número é estimado.
 */
export const ESTIMATIVA_SQL = `
  SELECT c.reltuples::bigint AS n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relname = $2
`;

// Bancos template e sem conexão permitida nunca são navegáveis.
export const BANCOS_SQL = `
  SELECT d.datname AS nome,
         CASE WHEN has_database_privilege(d.datname, 'CONNECT')
              THEN pg_size_pretty(pg_database_size(d.datname)) END AS tamanho
    FROM pg_database d
   WHERE NOT d.datistemplate AND d.datallowconn
   ORDER BY d.datname
`;

export const SCHEMAS_SQL = `
  SELECT n.nspname AS schema,
         pg_size_pretty(COALESCE(SUM(pg_total_relation_size(c.oid)), 0)) AS tamanho
    FROM pg_namespace n
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p', 'm')
   WHERE n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
   GROUP BY n.nspname
   ORDER BY n.nspname
`;

export const CONTAGENS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE') AS tables,
    (SELECT COUNT(*) FROM information_schema.views  WHERE table_schema = $1) AS views,
    (SELECT COUNT(*) FROM information_schema.routines
      WHERE routine_schema = $1 AND routine_type = 'FUNCTION') AS functions
`;

/** Estimativa de linhas do planner (reltuples): barata, ao contrário de count(*). */
export const TABELAS_SQL = `
  SELECT c.relname AS nome,
         CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS linhas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind = ANY($2){FILTRO}
   ORDER BY c.relname
`;

export const COLUNAS_SQL = `
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

export const FUNCOES_SQL = `
  SELECT p.proname AS nome, pg_get_function_result(p.oid) AS retorno
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = $1 AND p.prokind = 'f'{FILTRO}
   ORDER BY p.proname
`;

export const DDL_COLUNAS_SQL = `
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

export const DDL_PK_SQL = `
  SELECT a.attname AS nome
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
   WHERE n.nspname = $1 AND c.relname = $2 AND i.indisprimary
`;

/**
 * As colunas no formato dos modelos de SQL (spec 040).
 *
 * `pg_get_serial_sequence` é o que revela um `serial`/`identity`: no PostgreSQL
 * o auto-incremento não é uma marca na coluna, é uma sequência ligada a ela.
 */
export const COLUNAS_MODELO_SQL = `
  SELECT a.attname AS nome,
         format_type(a.atttypid, a.atttypmod) AS tipo,
         COALESCE(i.indisprimary, false) AS pk,
         (pg_get_serial_sequence(c.oid::regclass::text, a.attname) IS NOT NULL
          OR a.attidentity <> '') AS auto
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_index i ON i.indrelid = c.oid AND a.attnum = ANY(i.indkey) AND i.indisprimary
   WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY a.attnum
`;

/**
 * Os processos do servidor (spec 047).
 *
 * `pg_backend_pid()` marca a linha da própria conexão da IDE. `state` e `query`
 * só vêm preenchidos para quem tem privilégio — um usuário comum vê os próprios
 * processos com detalhe e os alheios sem, e isso é do servidor, não da IDE.
 */
export const PROCESSOS_SQL = `
  SELECT pid AS id, usename AS usuario, datname AS banco, state AS comando,
         wait_event_type AS estado,
         EXTRACT(EPOCH FROM (now() - query_start))::int AS segundos,
         query AS sql_texto,
         (pid = pg_backend_pid()) AS eu_mesmo
    FROM pg_stat_activity
   WHERE backend_type = 'client backend'
   ORDER BY segundos DESC NULLS LAST
`;
