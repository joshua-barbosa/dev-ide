// A borda discreta tirada das cores que o tema já deu.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerCor, misturar } from '../cores/misturar';

test('lê hex curto, hex longo e rgb', () => {
  assert.deepEqual(lerCor('#fff'), [255, 255, 255]);
  assert.deepEqual(lerCor('#BD93F9'), [189, 147, 249]);
  assert.deepEqual(lerCor('  rgb(10, 20, 30)  '), [10, 20, 30]);
  assert.deepEqual(lerCor('rgba(10 20 30 / 0.5)'), [10, 20, 30]);
});

test('o que não é cor devolve null, e não uma cor inventada', () => {
  for (const lixo of ['', 'var(--x)', 'transparent', '#12', 'rgb()']) {
    assert.equal(lerCor(lixo), null, lixo);
  }
  assert.equal(misturar('#000', 'nada', 0.2), null);
});

test('misturar respeita o peso, e os extremos são as próprias cores', () => {
  assert.equal(misturar('#ffffff', '#000000', 0), 'rgb(0, 0, 0)');
  assert.equal(misturar('#ffffff', '#000000', 1), 'rgb(255, 255, 255)');
  assert.equal(misturar('#ffffff', '#000000', 0.2), 'rgb(51, 51, 51)');
});

test('peso fora da faixa é aparado, e não vira cor impossível', () => {
  assert.equal(misturar('#ffffff', '#000000', 5), 'rgb(255, 255, 255)');
  assert.equal(misturar('#ffffff', '#000000', -2), 'rgb(0, 0, 0)');
});
