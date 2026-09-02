// Orçamento de desempenho (T098).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dentroDoOrcamento, emPalavras, mensagemDeEstouro, orcamentoDe, ORCAMENTOS,
} from '../orcamento';

test('todo orçamento explica POR QUE aquele número', () => {
  // Um teto sem motivo é um teto que alguém sobe no reflexo quando ele estoura.
  for (const o of ORCAMENTOS) {
    assert.ok(o.porque.length > 40, `"${o.nome}" não diz por que este número`);
    assert.ok(o.limite > 0);
  }
});

test('no limite exato, ainda está dentro', () => {
  const o = orcamentoDe('index');
  assert.equal(dentroDoOrcamento(o, o.limite), true);
  assert.equal(dentroDoOrcamento(o, o.limite + 1), false);
});

test('a mensagem de estouro diz o quanto passou E o que decidir', () => {
  const o = orcamentoDe('ide-pronta');
  const m = mensagemDeEstouro(o, o.limite * 1.5);
  assert.match(m, /50\.0% acima/);
  assert.match(m, /shared\/orcamento\.ts/, 'diz onde subir o número');
  assert.match(m, /JUNTO\s+com o motivo/, 'e que subir calado não vale');
});

test('bytes e milissegundos são lidos como gente lê', () => {
  assert.equal(emPalavras(5.5 * 1024 * 1024, 'bytes'), '5.50 MB');
  assert.equal(emPalavras(400 * 1024, 'bytes'), '400 kB');
  assert.equal(emPalavras(1234.6, 'ms'), '1235 ms');
});

test('orçamento inexistente estoura em vez de virar `undefined`', () => {
  // Um `undefined` aqui viraria um teste que nunca falha — o pior desfecho.
  assert.throws(() => orcamentoDe('nao-existe'), /Orçamento desconhecido/);
});
