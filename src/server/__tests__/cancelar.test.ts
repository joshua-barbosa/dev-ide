import assert from 'node:assert/strict';
import test from 'node:test';
import { comandoDeCancelamento } from '../connections/drivers/cancelar';

test('MySQL mata o COMANDO, e não a conexão', () => {
  // `KILL CONNECTION` levaria junto a transação aberta, o `SET SESSION
  // TRANSACTION READ ONLY` e o `MAX_EXECUTION_TIME`. O usuário pediu para parar
  // uma consulta, não para perder a conexão.
  const c = comandoDeCancelamento('mysql', 42);
  assert.equal(c.sql, 'KILL QUERY 42');
  assert.ok(!c.sql.includes('CONNECTION'));
});

test('Postgres cancela, e NUNCA termina o backend', () => {
  const c = comandoDeCancelamento('postgres', 42);
  assert.equal(c.sql, 'SELECT pg_cancel_backend($1)');
  assert.deepEqual(c.params, [42]);
  // `pg_terminate_backend` derruba a sessão. Não existe neste módulo de
  // propósito: o que não está escrito não é chamado por engano.
  assert.ok(!c.sql.includes('terminate'));
});

test('o id é conferido como inteiro positivo antes de entrar no SQL', () => {
  // No MySQL o número entra no texto (ele não aceita `?` no `KILL`), então esta
  // conferência é a única barreira que existe ali.
  for (const ruim of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => comandoDeCancelamento('mysql', ruim), /inválido/, String(ruim));
  }
});

test('nem texto disfarçado de número passa', () => {
  assert.throws(
    () => comandoDeCancelamento('mysql', '1; DROP TABLE x' as unknown as number),
    /inválido/
  );
});
