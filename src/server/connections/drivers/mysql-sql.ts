// As consultas ao catálogo do MySQL.
//
// Saíram de `mysql.ts` quando ele passou do teto de 800 linhas do Artigo IV — o
// portão da spec 028 o pegou em 807, ao ganhar a escrita pela grade (spec 044).
//
// Mesmo corte que o PostgreSQL levou na spec 041, e pelo mesmo motivo: nenhuma
// destas depende de estado, e todas respondem à mesma pergunta — "o que existe
// neste banco?".

export const CONTAGENS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE') AS tables,
    (SELECT COUNT(*) FROM information_schema.VIEWS  WHERE TABLE_SCHEMA = ?) AS views,
    (SELECT COUNT(*) FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION')  AS functions,
    (SELECT COUNT(*) FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE') AS procedures,
    (SELECT COUNT(*) FROM information_schema.EVENTS
      WHERE EVENT_SCHEMA = ?) AS events,
    (SELECT COUNT(*) FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ?) AS triggers
`;

/** Colunas com o que os MODELOS de SQL pedem: chave e auto-incremento. */
export const COLUNAS_MODELO_SQL = `
  SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY, EXTRA
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
   ORDER BY ORDINAL_POSITION
`;

/** Colunas com o que a ABA DE TABELA pede: chave e obrigatoriedade. */
export const COLUNAS_TABELA_SQL = `
  SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY, IS_NULLABLE
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
   ORDER BY ORDINAL_POSITION
`;

/** Colunas como a ÁRVORE as mostra: tipo, chave e NOT NULL em texto. */
export const COLUNAS_ARVORE_SQL = `
  SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
   ORDER BY ORDINAL_POSITION
`;

/**
 * A estimativa de linhas, do catálogo.
 *
 * `TABLE_ROWS` é estimativa no InnoDB — suficiente para orientar, e por isso a
 * aba de tabela só a usa dizendo que o número é estimado.
 */
export const ESTIMATIVA_SQL = `
  SELECT TABLE_ROWS AS n
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
`;

/**
 * Os processos do servidor (spec 047).
 *
 * `CONNECTION_ID()` marca a linha da PRÓPRIA conexão da IDE: ela aparece na
 * lista como qualquer outra, e matá-la derrubaria a sessão do usuário.
 *
 * Ordenado por tempo decrescente porque o processo que incomoda é o mais
 * antigo — e quem abre esta tela está caçando exatamente esse.
 */
export const PROCESSOS_SQL = `
  SELECT ID AS id, USER AS usuario, DB AS banco, COMMAND AS comando,
         STATE AS estado, TIME AS segundos, INFO AS sql_texto,
         (ID = CONNECTION_ID()) AS eu_mesmo
    FROM information_schema.PROCESSLIST
   ORDER BY TIME DESC
`;
