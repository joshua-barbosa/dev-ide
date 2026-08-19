import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codificarCarga, decodificarCarga, FRACAO_DE_BORDA, zonaDoPonto, type Retangulo,
} from '../arrastar';

/** Um retângulo redondo, para as contas lerem em porcentagem. */
const R: Retangulo = { x: 0, y: 0, largura: 1000, altura: 400 };

test('o meio é centro — abrir no próprio grupo é o caso comum', () => {
  assert.equal(zonaDoPonto(R, 500, 200), 'centro');
});

test('cada borda dá o seu lado', () => {
  assert.equal(zonaDoPonto(R, 50, 200), 'esquerda');
  assert.equal(zonaDoPonto(R, 950, 200), 'direita');
  assert.equal(zonaDoPonto(R, 500, 20), 'cima');
  assert.equal(zonaDoPonto(R, 500, 380), 'baixo');
});

test('O CANTO fica com a borda MAIS PRÓXIMA, não com a primeira testada', () => {
  // É o caso que erra: perto de (0,0) o ponto está dentro da faixa da esquerda
  // E da de cima. Testar em sequência daria sempre a mesma, e mirar em "cima"
  // entregaria "esquerda".
  //
  // Em (10, 60): 1% da esquerda, 15% do topo → esquerda.
  assert.equal(zonaDoPonto(R, 10, 60), 'esquerda');
  // Em (150, 4): 15% da esquerda, 1% do topo → cima.
  assert.equal(zonaDoPonto(R, 150, 4), 'cima');
  // Canto inferior direito, com a vertical mais perto.
  assert.equal(zonaDoPonto(R, 970, 398), 'baixo');
});

test('exatamente no limite da faixa ainda é centro', () => {
  // `<` e não `<=`: a faixa é aberta no fim, e a fronteira pertence ao centro.
  assert.equal(zonaDoPonto(R, R.largura * FRACAO_DE_BORDA, 200), 'centro');
});

test('um pixel dentro da faixa já é borda', () => {
  assert.equal(zonaDoPonto(R, R.largura * FRACAO_DE_BORDA - 1, 200), 'esquerda');
});

test('ponto FORA do retângulo conta como na borda', () => {
  // Arrastar depressa passa do alvo; recusar por um pixel seria punir a mão.
  assert.equal(zonaDoPonto(R, -50, 200), 'esquerda');
  assert.equal(zonaDoPonto(R, 1200, 200), 'direita');
  assert.equal(zonaDoPonto(R, 500, -10), 'cima');
});

test('retângulo sem área não divide nada', () => {
  assert.equal(zonaDoPonto({ x: 0, y: 0, largura: 0, altura: 0 }, 0, 0), 'centro');
  assert.equal(zonaDoPonto({ x: 0, y: 0, largura: 100, altura: 0 }, 50, 0), 'centro');
});

test('o retângulo pode não começar na origem', () => {
  const deslocado: Retangulo = { x: 300, y: 100, largura: 400, altura: 200 };
  assert.equal(zonaDoPonto(deslocado, 500, 200), 'centro');
  assert.equal(zonaDoPonto(deslocado, 320, 200), 'esquerda');
});

// ---------------------------------------------------------------------------
// A carga
// ---------------------------------------------------------------------------

test('arquivo e aba fazem a volta inteira', () => {
  for (const carga of [
    { tipo: 'arquivo', caminho: '/casa/projeto/a.ts' },
    { tipo: 'aba', id: 'file:/casa/projeto/a.ts' },
  ] as const) {
    assert.deepEqual(decodificarCarga(codificarCarga(carga)), carga);
  }
});

test('o que não é carga nossa devolve null', () => {
  // Um arraste vindo de fora da IDE não pode ser confundido com um dos nossos.
  for (const bruto of [
    '',
    'texto solto',
    '{}',
    '[]',
    '{"tipo":"arquivo"}',
    '{"tipo":"arquivo","caminho":""}',
    '{"tipo":"aba"}',
    '{"tipo":"aba","id":123}',
    '{"tipo":"inventado","caminho":"/x"}',
    'null',
  ]) {
    assert.equal(decodificarCarga(bruto), null, bruto);
  }
});

test('caminho com aspas e quebra de linha sobrevive à volta', () => {
  const carga = { tipo: 'arquivo', caminho: '/casa/a "b"\n/c.ts' } as const;
  assert.deepEqual(decodificarCarga(codificarCarga(carga)), carga);
});
