// O banco da conexão inicial do PostgreSQL.
//
// O defeito que motivou isto: com o campo vazio, a árvore abria em `postgres` e
// o terminal não passava `-d`. O `psql` caía no banco com o nome do usuário e o
// servidor respondia `FATAL: database "..." does not exist`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BANCO_INICIAL_POSTGRES, bancoInicialDoPostgres } from '../sql/banco-inicial';

test('campo vazio cai no banco de manutenção, e não no vazio', () => {
  for (const vazio of ['', '   ', undefined, null, 42]) {
    assert.equal(bancoInicialDoPostgres(vazio), BANCO_INICIAL_POSTGRES, String(vazio));
  }
});

test('o banco escolhido manda, e vem sem espaço em volta', () => {
  assert.equal(bancoInicialDoPostgres('acme_registros'), 'acme_registros');
  assert.equal(bancoInicialDoPostgres('  acme_registros  '), 'acme_registros');
});
