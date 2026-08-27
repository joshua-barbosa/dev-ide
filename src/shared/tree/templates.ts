// Esqueletos de criação, por tipo de objeto.
//
// Declarados pelo driver e entregues à interface pelo `meta` do nó de
// categoria. A interface não sabe o que é uma tabela do MySQL, e continua não
// sabendo — ela só abre numa aba o texto que recebeu.
//
// Categoria sem esqueleto aqui não ganha o botão de criar (AC-2).

export const TEMPLATES_MYSQL: Readonly<Record<string, string>> = {
  tables: [
    'CREATE TABLE `nova_tabela` (',
    '  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,',
    '  `nome` VARCHAR(255) NOT NULL,',
    '  `criado_em` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    '  PRIMARY KEY (`id`)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
  ].join('\n'),
  views: [
    'CREATE VIEW `nova_view` AS',
    'SELECT 1 AS exemplo;',
  ].join('\n'),
  procedures: [
    'DELIMITER $$',
    'CREATE PROCEDURE `novo_procedimento`(IN p_id INT)',
    'BEGIN',
    '  SELECT p_id;',
    'END$$',
    'DELIMITER ;',
  ].join('\n'),
  functions: [
    'DELIMITER $$',
    'CREATE FUNCTION `nova_funcao`(p_valor INT) RETURNS INT DETERMINISTIC',
    'BEGIN',
    '  RETURN p_valor;',
    'END$$',
    'DELIMITER ;',
  ].join('\n'),
  // Spec 069. O agendador precisa estar ligado (`event_scheduler = ON`), e por
  // isso o lembrete vai no próprio esqueleto: um evento criado com ele
  // desligado nasce válido e nunca roda.
  events: [
    '-- Exige event_scheduler = ON no servidor.',
    'CREATE EVENT `novo_evento`',
    'ON SCHEDULE EVERY 1 DAY',
    'DO',
    '  DELETE FROM `tabela` WHERE `criado_em` < NOW() - INTERVAL 30 DAY;',
  ].join('\n'),
};

export const TEMPLATES_POSTGRES: Readonly<Record<string, string>> = {
  tables: [
    'CREATE TABLE {schema}.nova_tabela (',
    '  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,',
    '  nome TEXT NOT NULL,',
    '  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()',
    ');',
  ].join('\n'),
  views: [
    'CREATE VIEW {schema}.nova_view AS',
    'SELECT 1 AS exemplo;',
  ].join('\n'),
  functions: [
    'CREATE FUNCTION {schema}.nova_funcao(p_valor integer)',
    'RETURNS integer',
    'LANGUAGE sql',
    'AS $$ SELECT p_valor $$;',
  ].join('\n'),
  // Spec 069 (T110): as quatro categorias novas do PostgreSQL.
  matviews: [
    'CREATE MATERIALIZED VIEW {schema}.nova_matview AS',
    'SELECT 1 AS exemplo',
    'WITH NO DATA;',
    '-- REFRESH MATERIALIZED VIEW {schema}.nova_matview;',
  ].join('\n'),
  sequences: [
    'CREATE SEQUENCE {schema}.nova_sequencia',
    '  START WITH 1 INCREMENT BY 1;',
  ].join('\n'),
  types: [
    "CREATE TYPE {schema}.novo_tipo AS ENUM ('um', 'outro');",
  ].join('\n'),
  foreign: [
    '-- Exige um servidor externo já criado (CREATE SERVER) e a extensão do FDW.',
    'CREATE FOREIGN TABLE {schema}.nova_tabela_externa (',
    '  id bigint,',
    '  nome text',
    ") SERVER servidor_externo OPTIONS (schema_name 'public', table_name 'origem');",
  ].join('\n'),
};

export const TEMPLATES_SQLITE: Readonly<Record<string, string>> = {
  tables: [
    'CREATE TABLE nova_tabela (',
    '  id INTEGER PRIMARY KEY,',
    '  nome TEXT NOT NULL,',
    "  criado_em TEXT NOT NULL DEFAULT (datetime('now'))",
    ');',
  ].join('\n'),
  views: [
    'CREATE VIEW nova_view AS',
    'SELECT 1 AS exemplo;',
  ].join('\n'),
  indexes: 'CREATE INDEX idx_nova ON tabela(coluna);',
};
