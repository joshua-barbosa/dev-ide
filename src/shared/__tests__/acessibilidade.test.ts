// As regras de acessibilidade que a IDE se cobra (T098).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conflitos, relatorio, REGRAS_COBRADAS, REGRAS_DISPENSADAS,
} from '../acessibilidade';

test('nenhuma regra está cobrada E dispensada ao mesmo tempo', () => {
  // Seria uma contradição calada: o teste passaria sem ninguém saber qual das
  // duas listas venceu.
  assert.deepEqual(conflitos(), []);
});

test('toda regra dispensada diz POR QUE foi dispensada', () => {
  for (const [regra, motivo] of Object.entries(REGRAS_DISPENSADAS)) {
    assert.ok(motivo.length > 40, `"${regra}" foi dispensada sem explicar`);
  }
});

test('a lista cobrada não é vazia nem cobre tudo', () => {
  // Vazia não protege; "tudo" vira teste que se desliga na primeira semana.
  assert.ok(REGRAS_COBRADAS.length >= 8);
  assert.ok(REGRAS_COBRADAS.includes('button-name'), 'a IDE é uma barra de ícones');
});

test('o relatório traz o SELETOR, e não só a contagem', () => {
  // "1 violação de button-name" não deixa ninguém consertar nada.
  const texto = relatorio([
    { regra: 'button-name', descricao: 'Botão sem nome', alvos: ['[data-x] > button:nth-child(2)'] },
  ]);
  assert.match(texto, /button-name/);
  assert.match(texto, /nth-child\(2\)/);
});

test('sem violação, o relatório diz isso com todas as letras', () => {
  assert.equal(relatorio([]), 'Nenhuma violação.');
});
