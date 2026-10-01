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

test('{{nome}} no lugar de uma TABELA: recado claro, em vez do erro de sintaxe do banco', () => {
  // O relato: "select * from {{messages}} as messages" deu "syntax error at or
  // near $1". {{ }} é VALOR (parâmetro); variável como tabela é a spec 114.
  for (const sql of ['select * from {{messages}} as m', 'SELECT * FROM t JOIN {{outra}} o ON o.id = t.id']) {
    assert.throws(() => montarSqlComParametros(sql, { messages: [], outra: [] }, 'dolar'), /valor.*não.*tabela/i);
  }
  // Como valor, depois de FROM, mas dentro de uma função, continua valendo.
  const r = montarSqlComParametros('select * from json_to_recordset({{j}}::json) as m(id int)', { j: '[]' }, 'dolar');
  assert.equal(r.sql, 'select * from json_to_recordset($1::json) as m(id int)');
});

// ---- sql() dentro do kernel (spec 114, C): parâmetros sempre com ? ----
import { trocarInterrogacoes } from '../notebook/parametros';

test('? vira o marcador do banco, na ordem', () => {
  assert.equal(trocarInterrogacoes('UPDATE t SET a = ? WHERE id = ?', 2, 'dolar'), 'UPDATE t SET a = $1 WHERE id = $2');
  assert.equal(trocarInterrogacoes('UPDATE t SET a = ? WHERE id = ?', 2, 'arroba'), 'UPDATE t SET a = @p1 WHERE id = @p2');
  assert.equal(trocarInterrogacoes('UPDATE t SET a = ? WHERE id = ?', 2, 'interrogacao'), 'UPDATE t SET a = ? WHERE id = ?');
});

test('? dentro de texto ou comentário não é parâmetro', () => {
  assert.equal(
    trocarInterrogacoes("SELECT '?' AS q, x FROM t -- e ?\nWHERE id = ? /* ? */", 1, 'dolar'),
    "SELECT '?' AS q, x FROM t -- e ?\nWHERE id = $1 /* ? */"
  );
});

test('quantidade de ? diferente da de valores: erro claro', () => {
  assert.throws(() => trocarInterrogacoes('SELECT ? , ?', 1, 'dolar'), /2 marcador.*1 valor/);
});

// ---- Pares no {{ }} (spec 114, A) ----
// O caso dele: "um update where (id and code) OR (id and code)" a partir de
// uma lista de objetos { id, code }.
import { colunasPedidas } from '../notebook/parametros';

const pedidos = [{ id: 1, code: 'a' }, { id: 2, code: 'b' }];

test('{{lista(id, code)}} vira pares de parâmetros para o IN de tupla', () => {
  const r = montarSqlComParametros('UPDATE t SET x = 1 WHERE (id, code) IN {{pedidos(id, code)}}', { pedidos }, 'dolar');
  assert.equal(r.sql, 'UPDATE t SET x = 1 WHERE (id, code) IN (($1, $2), ($3, $4))');
  assert.deepEqual(r.params, [1, 'a', 2, 'b']);
});

test('uma coluna só: a lista simples do IN', () => {
  const r = montarSqlComParametros('SELECT * FROM t WHERE id IN {{pedidos(id)}}', { pedidos }, 'interrogacao');
  assert.equal(r.sql, 'SELECT * FROM t WHERE id IN (?, ?)');
  assert.deepEqual(r.params, [1, 2]);
});

test('o nome pedido é a variável, sem as colunas', () => {
  assert.deepEqual(referenciasDoSql('SELECT 1 WHERE (a, b) IN {{pedidos(id, code)}} AND c IN {{ids}}'), ['pedidos', 'ids']);
  assert.deepEqual(colunasPedidas('SELECT 1 WHERE (a, b) IN {{pedidos(id, code)}} AND c IN {{ids}}'), ['pedidos']);
});

test('campo que falta num item vira NULL', () => {
  const r = montarSqlComParametros('… IN {{p(id, code)}}', { p: [{ id: 1 }] }, 'interrogacao');
  assert.deepEqual(r.params, [1, null]);
});

test('lista vazia: um par de NULL, que não casa nada', () => {
  const r = montarSqlComParametros('… IN {{p(id, code)}}', { p: [] }, 'dolar');
  assert.equal(r.sql, '… IN ((NULL, NULL))');
});

test('o que não é lista de objetos: erro claro', () => {
  assert.throws(() => montarSqlComParametros('… IN {{p(id)}}', { p: [1, 2] }, 'dolar'), /lista de objetos/);
  assert.throws(() => montarSqlComParametros('… IN {{p(id)}}', { p: 'x' }, 'dolar'), /lista de objetos/);
});

test('SQL Server não tem par no IN: erro que aponta o caminho', () => {
  assert.throws(() => montarSqlComParametros('… IN {{p(id, code)}}', { p: pedidos }, 'arroba'), /SQL Server.*sql\(\)/);
  // Uma coluna só ainda funciona: é a lista simples.
  assert.equal(montarSqlComParametros('… IN {{p(id)}}', { p: pedidos }, 'arroba').sql, '… IN (@p1, @p2)');
});

test('o ? do sql() não estraga um {{nome(col)}} que esteja no texto', () => {
  assert.equal(trocarInterrogacoes('SELECT ? WHERE x IN {{p(id)}}', 1, 'dolar'), 'SELECT $1 WHERE x IN {{p(id)}}');
});

// ---- {{item.campo}} (spec 114, B) ----
test('{{obj.campo}} lê o campo; o nome pedido ao kernel é o de fora', () => {
  assert.deepEqual(referenciasDoSql('UPDATE t SET a = {{item.nome}} WHERE id = {{item.id}}'), ['item']);
  const r = montarSqlComParametros('UPDATE t SET a = {{item.nome}} WHERE id = {{item.id}}', { item: { id: 7, nome: 'Ana' } }, 'dolar');
  assert.equal(r.sql, 'UPDATE t SET a = $1 WHERE id = $2');
  assert.deepEqual(r.params, ['Ana', 7]);
});

test('{{obj.a.b}}: campo dentro de campo; o que não existe vira NULL', () => {
  const r = montarSqlComParametros('SELECT {{x.a.b}}, {{x.falta}}', { x: { a: { b: 1 } } }, 'interrogacao');
  assert.deepEqual(r.params, [1, null]);
});

// ---- {{lista}} como TABELA (spec 114, D) ----
// O pedido: "select * from messages, onde messages é array de objects". O
// motor troca {{messages}} depois de FROM/JOIN pela função JSON do banco, com
// colunas e tipos INFERIDOS; o array vai como UM parâmetro.
import { tabelasPedidas } from '../notebook/parametros';

const messages = [{ id: 1, message: 'oi', lido: true, nota: 9.5 }, { id: 2, message: null, lido: false, nota: 7 }];

test('Postgres: json_to_recordset numa subconsulta, e o apelido dele vale', () => {
  const r = montarSqlComParametros('select m.id from {{messages}} m join users u on u.id = m.id', { messages }, 'dolar', 'postgres');
  assert.equal(r.sql,
    'select m.id from (SELECT * FROM json_to_recordset($1::json) AS _t("id" bigint, "message" text, "lido" boolean, "nota" double precision)) m join users u on u.id = m.id');
  assert.deepEqual(JSON.parse(String(r.params[0])), messages);
});

test('sem apelido: ganha o nome da variável (Postgres exige apelido em subconsulta)', () => {
  const r = montarSqlComParametros('select * from {{messages}} where id > 1', { messages }, 'dolar', 'postgres');
  assert.match(r.sql, /\) AS messages where id > 1$/);
});

test('MySQL: JSON_TABLE com caminho por coluna', () => {
  const r = montarSqlComParametros('SELECT * FROM {{messages}} AS m', { messages }, 'interrogacao', 'mysql');
  assert.equal(r.sql,
    "SELECT * FROM (SELECT * FROM JSON_TABLE(?, '$[*]' COLUMNS (`id` BIGINT PATH '$.\"id\"', `message` TEXT PATH '$.\"message\"', `lido` BOOLEAN PATH '$.\"lido\"', `nota` DOUBLE PATH '$.\"nota\"')) AS _t) AS m");
});

test('SQL Server: OPENJSON ... WITH', () => {
  const r = montarSqlComParametros('SELECT * FROM {{messages}} m', { messages }, 'arroba', 'sqlserver');
  assert.equal(r.sql,
    "SELECT * FROM (SELECT * FROM OPENJSON(@p1) WITH ([id] bigint '$.\"id\"', [message] nvarchar(max) '$.\"message\"', [lido] bit '$.\"lido\"', [nota] float '$.\"nota\"')) m");
});

test('SQLite: json_each + json_extract', () => {
  const r = montarSqlComParametros('SELECT * FROM {{messages}} m', { messages }, 'interrogacao', 'sqlite');
  assert.equal(r.sql,
    'SELECT * FROM (SELECT json_extract(value, \'$."id"\') AS "id", json_extract(value, \'$."message"\') AS "message", json_extract(value, \'$."lido"\') AS "lido", json_extract(value, \'$."nota"\') AS "nota" FROM json_each(?)) m');
});

test('lista de valores simples vira a coluna "valor"', () => {
  const r = montarSqlComParametros('select * from {{ids}} i', { ids: [1, 2] }, 'dolar', 'postgres');
  assert.match(r.sql, /_t\("valor" bigint\)\) i$/);
  assert.deepEqual(JSON.parse(String(r.params[0])), [{ valor: 1 }, { valor: 2 }]);
});

test('objeto dentro do item vira coluna JSON; texto e número misturados viram texto', () => {
  const r = montarSqlComParametros('select * from {{x}} t', { x: [{ a: { b: 1 }, c: 1 }, { a: null, c: 'dois' }] }, 'dolar', 'postgres');
  assert.match(r.sql, /"a" jsonb, "c" text/);
});

test('lista vazia: sem itens não há colunas — recado claro', () => {
  assert.throws(() => montarSqlComParametros('select * from {{x}} t', { x: [] }, 'dolar', 'postgres'), /vazia/);
});

test('sem saber o banco, FROM {{x}} continua com o recado de antes', () => {
  assert.throws(() => montarSqlComParametros('select * from {{x}} t', { x: [{ a: 1 }] }, 'dolar'), /VALOR/);
});

test('quais nomes são pedidos como tabela (o kernel entrega registros)', () => {
  assert.deepEqual(tabelasPedidas('select * from {{a}} x join {{b}} y on 1=1 where z in {{c}}'), ['a', 'b']);
});

test('SQL Server: objeto dentro do item — o AS JSON vem DEPOIS do caminho', () => {
  // Achado contra o SQL Server de verdade (conferir:tabela-json): antes do
  // caminho era "Incorrect syntax near '$.\"extra\"'".
  const r = montarSqlComParametros('SELECT * FROM {{x}} t', { x: [{ extra: { a: 1 } }] }, 'arroba', 'sqlserver');
  assert.match(r.sql, /\[extra\] nvarchar\(max\) '\$\."extra"' AS JSON\)/);
});
