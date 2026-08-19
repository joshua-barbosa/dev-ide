import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirTerminal, ativarTerminal, dividirTerminal, fecharTerminal, paneisVisiveis, paresDe,
  proximoTitulo, SEM_TERMINAIS,
} from '../terminais';

function comIds(...ids: string[]) {
  return ids.reduce((estado, id) => abrirTerminal(estado, id), SEM_TERMINAIS);
}

test('o primeiro terminal vira o ativo', () => {
  const e = abrirTerminal(SEM_TERMINAIS, 'a');
  assert.equal(e.ativo, 'a');
  assert.deepEqual(e.lista.map((t) => t.titulo), ['Terminal 1']);
});

test('abrir de novo o mesmo id só ativa, sem duplicar', () => {
  const e = abrirTerminal(comIds('a', 'b'), 'a');
  assert.equal(e.lista.length, 2);
  assert.equal(e.ativo, 'a');
});

test('os títulos seguem a ordem de abertura', () => {
  assert.deepEqual(comIds('a', 'b', 'c').lista.map((t) => t.titulo),
    ['Terminal 1', 'Terminal 2', 'Terminal 3']);
});

test('o número livre é reaproveitado ao fechar', () => {
  // Fechar o 1 e abrir outro deve dar "Terminal 1", não "Terminal 4".
  const depois = fecharTerminal(comIds('a', 'b', 'c'), 'a');
  assert.equal(proximoTitulo(depois.lista), 'Terminal 1');
});

test('fechar o ativo do meio ativa o VIZINHO DA DIREITA', () => {
  // É a pergunta que o store de abas já errou uma vez. Voltar para o primeiro
  // faria o usuário perder o lugar.
  const e = fecharTerminal(ativarTerminal(comIds('a', 'b', 'c'), 'b'), 'b');
  assert.equal(e.ativo, 'c');
});

test('fechar o último ativa o da esquerda', () => {
  const e = fecharTerminal(comIds('a', 'b', 'c'), 'c');
  assert.equal(e.ativo, 'b');
});

test('fechar o único deixa sem ativo', () => {
  const e = fecharTerminal(comIds('a'), 'a');
  assert.equal(e.ativo, null);
  assert.deepEqual(e.lista, []);
});

test('fechar um que não é o ativo não muda o ativo', () => {
  const e = fecharTerminal(comIds('a', 'b', 'c'), 'a');
  assert.equal(e.ativo, 'c', 'o ativo era o c, e continua');
  assert.equal(e.lista.length, 2);
});

test('fechar id inexistente não faz nada', () => {
  const antes = comIds('a', 'b');
  assert.deepEqual(fecharTerminal(antes, 'zzz'), antes);
});

test('ativar id inexistente é ignorado, em vez de deixar ativo fantasma', () => {
  const antes = comIds('a');
  assert.equal(ativarTerminal(antes, 'zzz').ativo, 'a');
});

test('fechar não muta o estado anterior', () => {
  const antes = comIds('a', 'b');
  fecharTerminal(antes, 'a');
  assert.equal(antes.lista.length, 2);
});

// ---------------------------------------------------------------------------
// Dividir terminal (spec 021)
// ---------------------------------------------------------------------------

test('um terminal comum é o único do par dele', () => {
  const e = comIds('a', 'b');
  assert.deepEqual(e.lista.map((t) => t.par), ['a', 'b']);
  assert.equal(paresDe(e).length, 2);
});

test('dividir põe o novo no MESMO par do ativo', () => {
  const e = dividirTerminal(comIds('a'), 'b');
  assert.deepEqual(e.lista.map((t) => t.par), ['a', 'a']);
  assert.equal(e.ativo, 'b');
  assert.equal(paresDe(e).length, 1, 'a lista lateral mostra um item só');
});

test('os panes visíveis são os do par do ativo', () => {
  let e = comIds('a');
  e = dividirTerminal(e, 'b');
  e = abrirTerminal(e, 'c');

  // O ativo é o `c`, que está sozinho.
  assert.deepEqual(paneisVisiveis(e).map((t) => t.id), ['c']);

  e = ativarTerminal(e, 'a');
  assert.deepEqual(paneisVisiveis(e).map((t) => t.id), ['a', 'b'], 'a e b dividem a tela');
});

test('sem ativo, não há pane visível', () => {
  assert.deepEqual(paneisVisiveis(SEM_TERMINAIS), []);
});

test('dividir sem ativo é o mesmo que abrir', () => {
  const e = dividirTerminal(SEM_TERMINAIS, 'a');
  assert.deepEqual(e.lista.map((t) => t.par), ['a']);
  assert.equal(e.ativo, 'a');
});

test('fechar um pane deixa o outro, e o par continua', () => {
  let e = dividirTerminal(comIds('a'), 'b');
  e = fecharTerminal(e, 'b');

  assert.deepEqual(e.lista.map((t) => t.id), ['a']);
  assert.equal(e.ativo, 'a');
  assert.equal(paresDe(e).length, 1);
});

test('fechar os dois panes tira o par da lista', () => {
  let e = dividirTerminal(comIds('a'), 'b');
  e = fecharTerminal(fecharTerminal(e, 'b'), 'a');
  assert.deepEqual(paresDe(e), []);
  assert.equal(e.ativo, null);
});

test('os títulos continuam únicos entre panes', () => {
  const e = dividirTerminal(comIds('a'), 'b');
  assert.deepEqual(e.lista.map((t) => t.titulo), ['Terminal 1', 'Terminal 2']);
});
