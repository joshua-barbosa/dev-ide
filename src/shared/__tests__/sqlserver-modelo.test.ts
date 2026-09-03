// SQL Server: o que ele faz diferente.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginar, PORQUE_SEM_TRAVA, selectDeAmostra } from '../sql/sqlserver-modelo';

test('OFFSET/FETCH exige ORDER BY, e ele é acrescentado quando falta', () => {
  // Não é preferência: o SQL Server recusa a consulta sem ele.
  const r = paginar('SELECT * FROM t', 'id', 0, 50);
  assert.match(r, /ORDER BY id/);
  assert.match(r, /OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY/);
});

test('ORDER BY que já existe NÃO é duplicado', () => {
  const r = paginar('SELECT * FROM t ORDER BY nome DESC', 'id', 0, 10);
  assert.equal((r.match(/ORDER BY/gi) ?? []).length, 1);
  assert.match(r, /ORDER BY nome DESC/);
});

test('sem coluna para ordenar, usa (SELECT NULL) — e não inventa uma', () => {
  // Ordenar por uma coluna escolhida no chute mudaria o resultado sem ninguém
  // pedir.
  assert.match(paginar('SELECT 1', null, 0, 10), /ORDER BY \(SELECT NULL\)/);
  assert.match(paginar('SELECT 1', '   ', 0, 10), /ORDER BY \(SELECT NULL\)/);
});

test('deslocamento negativo vira zero, e página zero vira um', () => {
  const r = paginar('SELECT 1', 'id', -5, 0);
  assert.match(r, /OFFSET 0 ROWS/);
  assert.match(r, /FETCH NEXT 1 ROWS/);
});

test('a amostra usa TOP, que é como se lê em SQL Server', () => {
  assert.equal(selectDeAmostra('dbo', 'alunos'), 'SELECT TOP 100 * FROM [dbo].[alunos];');
});

test('colchete no nome da tabela é escapado na amostra', () => {
  assert.equal(selectDeAmostra('dbo', 'a]b', 1), 'SELECT TOP 1 * FROM [dbo].[a]]b];');
});

test('o motivo de não haver trava está escrito, e diz o que fazer', () => {
  // Uma trava que se contorna é pior que trava nenhuma: quem confia nela
  // arrisca mais.
  assert.match(PORQUE_SEM_TRAVA, /não tem somente-leitura de sessão/);
  assert.match(PORQUE_SEM_TRAVA, /sp_executesql/);
  assert.match(PORQUE_SEM_TRAVA, /login somente-leitura/);
});
