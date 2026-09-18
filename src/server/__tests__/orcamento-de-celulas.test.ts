import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CELL_CHARS, ORCAMENTO_PADRAO, OrcamentoDeCelulas,
} from '../connections/drivers/sql-base';

const texto = (n: number) => 'x'.repeat(n);

test('valor grande vem INTEIRO enquanto há orçamento', () => {
  // O defeito que ele relatou: um JSON de 14 mil caracteres chegava com 2048 e
  // um "…", quebrando o JSON — e o visor mostrava isso como se fosse o valor.
  const o = new OrcamentoDeCelulas();
  const [valor] = o.linha(0, [texto(14_618)]);
  assert.equal(valor, texto(14_618));
  assert.deepEqual(o.cortes, {});
});

test('o orçamento é da PÁGINA: soma célula a célula', () => {
  const o = new OrcamentoDeCelulas(10_000);
  o.linha(0, [texto(6000)]);
  const [segunda] = o.linha(1, [texto(6000)]);
  assert.equal(segunda, `${texto(MAX_CELL_CHARS)}…`);
});

test('o que não coube é MARCADO, com o tamanho de verdade', () => {
  const o = new OrcamentoDeCelulas(1000);
  o.linha(0, ['cabe', texto(50_000)]);
  assert.deepEqual(o.cortes, { '0:1': 50_000 });
});

test('célula maior que o orçamento inteiro vem como amostra, não estoura', () => {
  const o = new OrcamentoDeCelulas(10_000);
  const [valor] = o.linha(0, [texto(3_000_000)]);
  assert.equal((valor as string).length, MAX_CELL_CHARS + 1);
  assert.equal(o.cortes['0:0'], 3_000_000);
});

test('o que não é texto não gasta orçamento nem é cortado', () => {
  const o = new OrcamentoDeCelulas(10);
  assert.deepEqual(o.linha(0, [1, true, null, 10n]), [1, true, null, '10']);
  assert.deepEqual(o.cortes, {});
});

test('binário grande respeita o teto, em hexadecimal', () => {
  const o = new OrcamentoDeCelulas(100);
  const [valor] = o.linha(0, [new Uint8Array(5000)]);
  assert.equal(typeof valor, 'string');
  assert.ok((valor as string).length <= MAX_CELL_CHARS + 1, `veio com ${(valor as string).length}`);
  assert.equal(o.cortes['0:0'], 10_002); // "0x" + dois dígitos por byte
});

test('o padrão é 8 MB', () => {
  assert.equal(ORCAMENTO_PADRAO, 8 * 1024 * 1024);
});
