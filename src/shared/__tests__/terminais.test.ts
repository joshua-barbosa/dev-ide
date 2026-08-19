import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirTerminal, ativarTerminal, fecharTerminal, proximoTitulo, SEM_TERMINAIS,
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
