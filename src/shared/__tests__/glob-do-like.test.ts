import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globDoLike } from '../tree/glob-do-like';

test('% vira * e _ vira ?', () => {
  assert.equal(globDoLike('%turmas%'), '*turmas*');
  assert.equal(globDoLike('fila_1'), 'fila?1');
});

test('o que é curinga no GLOB e literal no LIKE é escapado', () => {
  // Sem isto, uma chave chamada `fila[1]` nunca seria encontrada pelo nome.
  assert.equal(globDoLike('fila[1]'), 'fila\\[1\\]');
  assert.equal(globDoLike('a*b'), 'a\\*b');
  assert.equal(globDoLike('a?b'), 'a\\?b');
});

test('o escape do LIKE devolve o caractere como literal', () => {
  assert.equal(globDoLike('100\\%'), '100%');
  assert.equal(globDoLike('a\\_b'), 'a_b');
});

test('padrão vazio continua vazio', () => {
  assert.equal(globDoLike(''), '');
});
