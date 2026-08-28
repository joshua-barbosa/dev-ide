// As funções internas do MySQL (T053, spec 071).
//
// **Esta lista é escrita à mão, e isso é uma escolha declarada.** O MySQL não
// expõe as próprias funções em catálogo nenhum: `information_schema.ROUTINES`
// só traz as do usuário. O PostgreSQL tem as dele em `pg_catalog` e o SQLite
// responde `PRAGMA function_list` — nesses dois a lista é a verdade do
// servidor, e não uma tabela daqui.
//
// O risco de uma lista à mão é envelhecer, e ele é assimétrico: faltar uma
// função custa uma sugestão a menos, e sobrar uma custa uma sugestão que o
// banco recusa. Por isso só entram as que existem há muitas versões.

export const FUNCOES_DO_MYSQL: readonly string[] = [
  // Texto
  'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTRING_INDEX', 'LEFT', 'RIGHT',
  'TRIM', 'LTRIM', 'RTRIM', 'LOWER', 'UPPER', 'LENGTH', 'CHAR_LENGTH',
  'REPLACE', 'REVERSE', 'REPEAT', 'LPAD', 'RPAD', 'LOCATE', 'INSTR',
  'FIELD', 'FIND_IN_SET', 'GROUP_CONCAT', 'ELT', 'FORMAT', 'HEX', 'UNHEX',
  // Data e hora
  'NOW', 'CURDATE', 'CURTIME', 'CURRENT_TIMESTAMP', 'UNIX_TIMESTAMP',
  'FROM_UNIXTIME', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE',
  'SECOND', 'DAYOFWEEK', 'DAYOFYEAR', 'WEEK', 'QUARTER', 'DATE_ADD',
  'DATE_SUB', 'DATEDIFF', 'TIMESTAMPDIFF', 'TIMESTAMPADD', 'DATE_FORMAT',
  'STR_TO_DATE', 'LAST_DAY', 'MAKEDATE', 'SEC_TO_TIME', 'TIME_TO_SEC',
  // Número
  'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNCATE', 'MOD', 'POW',
  'POWER', 'SQRT', 'EXP', 'LOG', 'LOG10', 'RAND', 'SIGN', 'GREATEST', 'LEAST',
  // Agregação e janela
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'STDDEV', 'VARIANCE',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE',
  'LAST_VALUE', 'NTILE',
  // Condicional e nulo
  'IF', 'IFNULL', 'NULLIF', 'COALESCE',
  // JSON
  'JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_OBJECT', 'JSON_ARRAY', 'JSON_CONTAINS',
  'JSON_KEYS', 'JSON_LENGTH', 'JSON_SET', 'JSON_INSERT', 'JSON_REMOVE',
  'JSON_MERGE_PATCH', 'JSON_VALID', 'JSON_TABLE',
  // Outras
  'CAST', 'CONVERT', 'UUID', 'DATABASE', 'USER', 'VERSION', 'MD5', 'SHA2',
  'LAST_INSERT_ID', 'ROW_COUNT',
];
