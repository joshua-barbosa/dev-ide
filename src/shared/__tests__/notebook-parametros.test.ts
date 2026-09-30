// `{{nome}}` numa célula SQL: o valor vem do kernel, SEMPRE como parâmetro
// (spec 112, etapa 4). Colado no texto, uma variável com aspas viraria injeção
// de SQL — por isso aqui não há concatenação de valor em lugar nenhum.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarSqlComParametros, referenciasDoSql } from '../notebook/parametros';

test('acha as referências, sem repetir', () => {
  assert.deepEqual(referenciasDoSql('SELECT * FROM t WHERE a = {{x}} AND b IN {{ ids }} OR c = {{x}}'), ['x', 'ids']);
});

test('dentro de texto ou comentário NÃO é referência', () => {
  const sql = "SELECT '{{nao}}', \"{{nem}}\" -- {{tambem_nao}}\n/* {{nada}} */ FROM t WHERE id = {{sim}}";
  assert.deepEqual(referenciasDoSql(sql), ['sim']);
});

test('valor escalar vira UM marcador, e o valor vai à parte', () => {
  const r = montarSqlComParametros('SELECT * FROM t WHERE nome = {{n}}', { n: "O'Brien; DROP TABLE t" }, 'interrogacao');
  assert.equal(r.sql, 'SELECT * FROM t WHERE nome = ?');
  assert.deepEqual(r.params, ["O'Brien; DROP TABLE t"]);
});

test('lista vira IN (?, ?, ?)', () => {
  const r = montarSqlComParametros('SELECT * FROM t WHERE id IN {{ids}}', { ids: [1, 2, 3] }, 'interrogacao');
  assert.equal(r.sql, 'SELECT * FROM t WHERE id IN (?, ?, ?)');
  assert.deepEqual(r.params, [1, 2, 3]);
});

test('lista VAZIA vira (NULL): não casa nada, e não é erro de sintaxe', () => {
  const r = montarSqlComParametros('SELECT * FROM t WHERE id IN {{ids}}', { ids: [] }, 'interrogacao');
  assert.equal(r.sql, 'SELECT * FROM t WHERE id IN (NULL)');
  assert.deepEqual(r.params, []);
});

test('Postgres numera: $1, $2…', () => {
  const r = montarSqlComParametros('SELECT {{a}}, {{b}} WHERE x IN {{c}}', { a: 1, b: 'x', c: [7, 8] }, 'dolar');
  assert.equal(r.sql, 'SELECT $1, $2 WHERE x IN ($3, $4)');
  assert.deepEqual(r.params, [1, 'x', 7, 8]);
});

test('SQL Server nomeia: @p1, @p2…', () => {
  const r = montarSqlComParametros('SELECT {{a}} WHERE x IN {{c}}', { a: true, c: ['k'] }, 'arroba');
  assert.equal(r.sql, 'SELECT @p1 WHERE x IN (@p2)');
  assert.deepEqual(r.params, [true, 'k']);
});

test('variável que o kernel não tem: erro claro, e nada roda', () => {
  assert.throws(
    () => montarSqlComParametros('SELECT {{fantasma}}', {}, 'interrogacao'),
    /fantasma.*não existe no kernel/
  );
});

test('objeto vira JSON, null segue null', () => {
  const r = montarSqlComParametros('INSERT INTO t VALUES ({{o}}, {{nada}})', { o: { a: 1 }, nada: null }, 'interrogacao');
  assert.deepEqual(r.params, ['{"a":1}', null]);
});

test('o texto de fora continua EXATAMENTE igual', () => {
  const sql = "SELECT 'a''b', `c` FROM t -- {{x}}\nWHERE y = {{y}}";
  assert.equal(montarSqlComParametros(sql, { y: 1 }, 'interrogacao').sql, "SELECT 'a''b', `c` FROM t -- {{x}}\nWHERE y = ?");
});
