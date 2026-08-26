import assert from 'node:assert/strict';
import test from 'node:test';
import { acharFormulas, temFormula } from '../matematica';

const so = (t: string) => acharFormulas(t).map((f) => `${f.modo}:${f.conteudo}`);

test('fórmula de linha e de bloco', () => {
  assert.deepEqual(so('a $x^2$ b'), ['linha:x^2']);
  assert.deepEqual(so('$$\\frac{1}{2}$$'), ['bloco:\\frac{1}{2}']);
});

test('`$$` é lido ANTES de `$` — senão viraria duas vazias', () => {
  assert.deepEqual(acharFormulas('$$x$$').length, 1);
  assert.equal(acharFormulas('$$x$$')[0]?.modo, 'bloco');
});

test('preço NÃO vira matemática', () => {
  // `R$ 10` e `US$ 5` aparecem em README de projeto brasileiro o tempo todo.
  assert.deepEqual(so('custa R$ 10 e R$ 20'), []);
  assert.deepEqual(so('de $100 por $80'), []);
});

test('cifrão sozinho não abre nada', () => {
  assert.deepEqual(so('o preço é $'), []);
  assert.deepEqual(so('use $HOME no shell'), []);
});

test('`\\$` é cifrão literal, escapado pelo usuário', () => {
  assert.deepEqual(so('custa \\$x$ mesmo'), []);
});

test('fórmula vazia não conta', () => {
  assert.deepEqual(so('nada $$ aqui'), []);
  assert.deepEqual(so('nem $   $ aqui'), []);
});

test('duas fórmulas na mesma linha, com as posições certas', () => {
  const f = acharFormulas('$a$ e $b$');
  assert.equal(f.length, 2);
  assert.equal(f[0]?.inicio, 0);
  assert.equal(f[1]?.conteudo, 'b');
});

test('o conteúdo sai SEM os cifrões', () => {
  assert.equal(acharFormulas('$\\alpha$')[0]?.conteudo, '\\alpha');
});

test('temFormula decide se vale carregar o KaTeX', () => {
  assert.equal(temFormula('texto comum'), false);
  assert.equal(temFormula('custa R$ 5'), false);
  assert.equal(temFormula('a $x$ b'), true);
});
