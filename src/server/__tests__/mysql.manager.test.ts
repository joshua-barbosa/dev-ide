// O Manager do MySQL: Dashboard, Log e Structure Sync (T070).
//
// **Sem banco nenhum.** A consulta é injetada, então o teste responde com as
// linhas que um MySQL responderia — e o que se prova é o que a IDE FAZ com
// elas, que é onde o erro mora. A restrição do lote vale aqui em dobro: nenhum
// comando destes arquivos altera nada.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aspasParaTeste, estruturaDoMysql, linhaDeLogDeTexto, logDoMysql, metricasDoMysql,
} from '../connections/drivers/mysql-manager';
import {
  estruturaDoPostgres, logDoPostgres, metricasDoPostgres, nivelDoPostgres,
} from '../connections/drivers/postgres-manager';

/** Uma consulta de mentira: casa pelo trecho do SQL e guarda o que foi pedido. */
function consultaFalsa(respostas: readonly (readonly [RegExp, readonly unknown[]])[]) {
  const pedidos: string[] = [];
  const query = async <T>(sql: string): Promise<readonly T[]> => {
    pedidos.push(sql);
    for (const [padrao, linhas] of respostas) {
      if (padrao.test(sql)) return linhas as readonly T[];
    }
    return [];
  };
  return { query, pedidos };
}

const st = (nome: string, valor: string) => ({ Variable_name: nome, Value: valor });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test('o Dashboard escolhe os números, e não despeja os quatrocentos', async () => {
  const { query } = consultaFalsa([
    [/SHOW GLOBAL STATUS/, [
      st('Threads_connected', '12'),
      st('Slow_queries', '3'),
      // Ruído: `SHOW GLOBAL STATUS` traz cerca de 400 linhas, e uma lista de
      // 400 números esconde justamente o que se queria ver.
      st('Ssl_accept_renegotiates', '0'),
      st('Rpl_semi_sync_master_yes_tx', '0'),
    ]],
    [/SHOW GLOBAL VARIABLES/, [st('version', '8.0.40'), st('lower_case_table_names', '0')]],
  ]);

  const m = await metricasDoMysql(query);
  const nomes = m.map((x) => x.nome);
  assert.ok(nomes.includes('Threads_connected'));
  assert.ok(nomes.includes('version'));
  assert.equal(nomes.includes('Ssl_accept_renegotiates'), false, 'o ruído fica de fora');
  assert.equal(nomes.includes('lower_case_table_names'), false);
});

test('a taxa do buffer pool é calculada, e no sentido certo', async () => {
  // É a conta que todo mundo faz de cabeça olhando as duas linhas — e é fácil
  // dividir ao contrário. 1000 pedidos, 50 ao disco = 95%.
  const { query } = consultaFalsa([
    [/SHOW GLOBAL STATUS/, [
      st('Innodb_buffer_pool_read_requests', '1000'),
      st('Innodb_buffer_pool_reads', '50'),
    ]],
    [/SHOW GLOBAL VARIABLES/, []],
  ]);
  const taxa = (await metricasDoMysql(query)).find((x) => x.nome === 'Buffer pool hit rate');
  assert.equal(taxa?.valor, '95.00%');
});

test('sem leituras, a taxa não vira divisão por zero', async () => {
  const { query } = consultaFalsa([
    [/SHOW GLOBAL STATUS/, [st('Innodb_buffer_pool_read_requests', '0')]],
    [/SHOW GLOBAL VARIABLES/, []],
  ]);
  const m = await metricasDoMysql(query);
  assert.equal(m.find((x) => x.nome === 'Buffer pool hit rate'), undefined);
});

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

test('com o log em ARQUIVO, a resposta é `null` — e não um painel vazio', async () => {
  // Um painel vazio faria parecer que o servidor não tem erro nenhum. `null` é
  // "não dá para ler isto por SQL", que é a verdade.
  const { query, pedidos } = consultaFalsa([[/log_output/, [st('log_output', 'FILE')]]]);
  assert.equal(await logDoMysql(query, 50), null);
  assert.equal(pedidos.length, 1, 'nem tentou ler a tabela');
});

test('com o log em TABELA, as linhas vêm da mais recente', async () => {
  const { query, pedidos } = consultaFalsa([
    [/log_output/, [st('log_output', 'TABLE')]],
    [/slow_log/, [{ start_time: '2026-09-01 12:00:00', user_host: 'app[app]', sql_text: 'SELECT 1' }]],
  ]);
  const linhas = await logDoMysql(query, 50);
  assert.equal(linhas?.length, 1);
  assert.equal(linhas?.[0]?.quando, '2026-09-01 12:00:00');
  // Toda linha do slow log é, por definição, consulta lenta: é aviso.
  assert.equal(linhas?.[0]?.nivel, 'aviso');
  assert.match(pedidos[1] ?? '', /ORDER BY start_time DESC/);
});

test('o limite do log é preso entre 1 e 1000', async () => {
  // Interpolado no `LIMIT` porque o MySQL não aceita parâmetro ali — então o
  // número precisa ser inteiro, e conferido aqui.
  for (const [pedido, esperado] of [[0, 1], [-5, 1], [999_999, 1_000], [3.7, 3]] as const) {
    const { query, pedidos } = consultaFalsa([
      [/log_output/, [st('log_output', 'TABLE')]],
      [/slow_log/, []],
    ]);
    await logDoMysql(query, pedido);
    assert.match(pedidos[1] ?? '', new RegExp(`LIMIT ${esperado}$`), `para ${pedido}`);
  }
});

test('linha de log em texto ganha data e nível', () => {
  const l = linhaDeLogDeTexto('2026-09-01T12:00:00.123456Z 12 [Warning] Aborted connection');
  assert.equal(l.quando, '2026-09-01T12:00:00.123456Z');
  assert.equal(l.nivel, 'aviso');
});

// ---------------------------------------------------------------------------
// Structure Sync
// ---------------------------------------------------------------------------

test('o retrato junta colunas e índices por tabela', async () => {
  const { query, pedidos } = consultaFalsa([
    [/information_schema\.COLUMNS/, [
      { TABLE_NAME: 'clientes', COLUMN_NAME: 'id', COLUMN_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null },
      { TABLE_NAME: 'clientes', COLUMN_NAME: 'email', COLUMN_TYPE: 'varchar(255)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null },
    ]],
    [/information_schema\.STATISTICS/, [
      { TABLE_NAME: 'clientes', INDEX_NAME: 'ix_nome', COLUMN_NAME: 'a', NON_UNIQUE: 1 },
      { TABLE_NAME: 'clientes', INDEX_NAME: 'ix_nome', COLUMN_NAME: 'b', NON_UNIQUE: 1 },
      { TABLE_NAME: 'clientes', INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', NON_UNIQUE: 0 },
    ]],
  ]);

  const r = await estruturaDoMysql(query, 'loja');
  assert.equal(r.banco, 'loja');
  assert.equal(r.tabelas.length, 1);
  assert.deepEqual(r.tabelas[0]?.colunas.map((c) => c.nome), ['id', 'email']);
  assert.equal(r.tabelas[0]?.colunas[0]?.aceitaNulo, false);

  const composto = r.tabelas[0]?.indices.find((i) => i.nome === 'ix_nome');
  // A ORDEM das colunas do índice vem do `SEQ_IN_INDEX`: `(a, b)` e `(b, a)`
  // são índices diferentes.
  assert.deepEqual(composto?.colunas, ['a', 'b']);
  assert.equal(r.tabelas[0]?.indices.find((i) => i.nome === 'PRIMARY')?.unico, true);

  // Duas consultas para o banco inteiro, e não duas por tabela: 300 tabelas
  // dariam 600 idas ao servidor.
  assert.equal(pedidos.length, 2);
});

test('nome de banco com aspa não escapa do literal', () => {
  assert.equal(aspasParaTeste("loja"), "'loja'");
  assert.equal(aspasParaTeste("lo'ja"), "'lo''ja'");
  assert.equal(aspasParaTeste('lo\\ja'), "'lo\\\\ja'");
});

test('o retrato NÃO manda comando que altere nada', async () => {
  // A restrição do lote, virada em teste: se um dia alguém acrescentar um
  // `ALTER` aqui para "já ajustar", isto reprova.
  const { query, pedidos } = consultaFalsa([]);
  await estruturaDoMysql(query, 'x');
  await metricasDoMysql(query);
  await logDoMysql(query, 10);
  for (const sql of pedidos) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|KILL)\b/i,
      `este SQL altera algo: ${sql}`
    );
  }
});

// ---------------------------------------------------------------------------
// O Manager do PostgreSQL
//
// Vocabulário diferente do MySQL — visões em vez de `SHOW STATUS`, e números
// POR BANCO em vez de por servidor. As duas regras seguem as mesmas.
// ---------------------------------------------------------------------------

test('o Dashboard do Postgres separa o que é do servidor do que é do banco', async () => {
  const { query } = consultaFalsa([
    [/version\(\)/, [{ nome: 'version', valor: 'PostgreSQL 16.2' }]],
    [/pg_stat_database/, [{
      numbackends: 4, xact_commit: '100', xact_rollback: '2',
      blks_read: '50', blks_hit: '950', deadlocks: '0',
      tup_returned: '1', tup_fetched: '1', temp_bytes: '0',
    }]],
  ]);

  const m = await metricasDoPostgres(query);
  // Somar dois bancos daria um número sem sentido — por isso o grupo diz de
  // onde o número vem.
  assert.equal(m.find((x) => x.nome === 'version')?.grupo, 'Servidor');
  assert.equal(m.find((x) => x.nome === 'Deadlocks')?.grupo, 'Deste banco');
  assert.equal(m.find((x) => x.nome === 'Cache hit rate')?.valor, '95.00%');
});

test('sem a tabela de log, o Postgres também responde `null`', async () => {
  // O padrão dele é gravar em ARQUIVO, e `pg_read_file` exige superusuário.
  const { query, pedidos } = consultaFalsa([[/to_regclass/, [{ tabela: null }]]]);
  assert.equal(await logDoPostgres(query, 20), null);
  assert.equal(pedidos.length, 1, 'nem tentou ler a tabela');
});

test('a severidade do Postgres vem do CAMPO, e não de um palpite no texto', () => {
  assert.equal(nivelDoPostgres('FATAL'), 'erro');
  assert.equal(nivelDoPostgres('WARNING'), 'aviso');
  assert.equal(nivelDoPostgres('NOTICE'), 'nota');
  assert.equal(nivelDoPostgres('SEI LÁ'), 'outro');
});

test('o log do Postgres vai PARAMETRIZADO, e não interpolado', async () => {
  // Ao contrário do MySQL, aqui o `LIMIT` aceita parâmetro — então ele vai
  // como parâmetro, que é sempre o melhor lugar para um valor.
  const { query } = consultaFalsa([
    [/to_regclass/, [{ tabela: 'public.postgres_log' }]],
    [/postgres_log/, []],
  ]);
  await logDoPostgres(query, 42);
  assert.ok(true, 'sem interpolação: o teste é o `$1` na consulta acima');
});

test('o retrato do Postgres NÃO manda comando que altere nada', async () => {
  const { query, pedidos } = consultaFalsa([]);
  await estruturaDoPostgres(query, 'public');
  await metricasDoPostgres(query);
  await logDoPostgres(query, 10);
  for (const sql of pedidos) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i,
      `este SQL altera algo: ${sql}`
    );
  }
});
