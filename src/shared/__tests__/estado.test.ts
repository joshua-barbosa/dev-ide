import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirPasta, esquecerPasta, ESTADO_VAZIO, fecharPasta, MAX_RECENTES, normalizarEstado,
} from '../estado';

test('estado vazio é o padrão de tudo que não dá para ler', () => {
  for (const entrada of [undefined, null, 42, 'x', [], ['a']]) {
    assert.deepEqual(normalizarEstado(entrada), ESTADO_VAZIO);
  }
});

test('a IDE nasce sem pasta, e não escolhendo uma por conta própria', () => {
  assert.equal(ESTADO_VAZIO.pastaAtual, null);
  assert.deepEqual(ESTADO_VAZIO.recentes, []);
});

test('normalizar descarta entrada que não é texto', () => {
  const e = normalizarEstado({ pastaAtual: 7, recentes: ['/a', 3, null, '', '/b'] });
  assert.equal(e.pastaAtual, null);
  assert.deepEqual(e.recentes, ['/a', '/b']);
});

test('a pasta atual sempre aparece nos recentes, mesmo se o arquivo não a listou', () => {
  const e = normalizarEstado({ pastaAtual: '/atual', recentes: ['/outra'] });
  assert.deepEqual(e.recentes, ['/atual', '/outra']);
});

test('abrir põe a pasta no topo e a torna atual', () => {
  const e = abrirPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b');
  assert.equal(e.pastaAtual, '/b');
  assert.deepEqual(e.recentes, ['/b', '/a']);
});

test('reabrir uma pasta a move para o topo em vez de duplicar', () => {
  let e = ESTADO_VAZIO;
  for (const p of ['/a', '/b', '/c', '/a']) e = abrirPasta(e, p);
  assert.deepEqual(e.recentes, ['/a', '/c', '/b']);
});

test('a lista de recentes para de crescer', () => {
  let e = ESTADO_VAZIO;
  for (let i = 0; i < MAX_RECENTES + 5; i += 1) e = abrirPasta(e, `/pasta-${i}`);
  assert.equal(e.recentes.length, MAX_RECENTES);
  assert.equal(e.recentes[0], `/pasta-${MAX_RECENTES + 4}`, 'a mais nova fica no topo');
});

test('abrir não muta o estado anterior', () => {
  const antes = abrirPasta(ESTADO_VAZIO, '/a');
  abrirPasta(antes, '/b');
  assert.deepEqual(antes.recentes, ['/a']);
  assert.equal(antes.pastaAtual, '/a');
});

test('fechar preserva o histórico', () => {
  const e = fecharPasta(abrirPasta(ESTADO_VAZIO, '/a'));
  assert.equal(e.pastaAtual, null);
  assert.deepEqual(e.recentes, ['/a']);
});

test('esquecer tira dos recentes e solta a atual se for ela', () => {
  const e = esquecerPasta(abrirPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b'), '/b');
  assert.equal(e.pastaAtual, null);
  assert.deepEqual(e.recentes, ['/a']);
});

test('esquecer outra pasta não mexe na atual', () => {
  const e = esquecerPasta(abrirPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b'), '/a');
  assert.equal(e.pastaAtual, '/b');
  assert.deepEqual(e.recentes, ['/b']);
});
