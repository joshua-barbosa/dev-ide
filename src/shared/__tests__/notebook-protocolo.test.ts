// A conversa entre o motor e o kernel (spec 112, etapa 2).
//
// O kernel escreve no MESMO canal o `print` do usuário e as mensagens para o
// motor. A marca que abre cada mensagem é o que separa as duas coisas — e o
// canal chega picado em pedaços arbitrários.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARCA, mensagem, separar } from '../notebook/protocolo';

const fim = { tipo: 'fim', exec: 1, ok: true };

test('texto puro passa como texto', () => {
  assert.deepEqual(separar('olá\n'), { itens: [{ texto: 'olá\n' }], resto: '' });
});

test('uma mensagem sozinha', () => {
  assert.deepEqual(separar(mensagem(fim)), { itens: [{ mensagem: fim }], resto: '' });
});

test('print SEM quebra de linha antes da mensagem não a engole', () => {
  // `print('abc', end='')` seguido do fim da célula: a marca vem no meio da linha.
  const r = separar(`abc${mensagem(fim)}`);
  assert.deepEqual(r.itens, [{ texto: 'abc' }, { mensagem: fim }]);
});

test('mensagem partida em dois pedaços espera o resto', () => {
  const inteira = mensagem(fim);
  const a = separar(`x${inteira.slice(0, 10)}`);
  assert.deepEqual(a.itens, [{ texto: 'x' }]);
  const b = separar(a.resto + inteira.slice(10));
  assert.deepEqual(b.itens, [{ mensagem: fim }]);
});

test('pedaço que termina no MEIO da marca também espera', () => {
  const a = separar(`oi${MARCA.slice(0, 2)}`);
  assert.deepEqual(a.itens, [{ texto: 'oi' }]);
  assert.equal(a.resto, MARCA.slice(0, 2));
});

test('texto depois da mensagem continua sendo texto', () => {
  const r = separar(`${mensagem(fim)}depois\n`);
  assert.deepEqual(r.itens, [{ mensagem: fim }, { texto: 'depois\n' }]);
});

test('mensagem estragada vira texto, não derruba a leitura', () => {
  const r = separar(`${MARCA}{isso não é json\n`);
  assert.equal(r.itens.length, 1);
  assert.ok('texto' in r.itens[0]);
});

test('a mensagem gravada é uma linha só, mesmo com quebra dentro do texto', () => {
  const m = mensagem({ tipo: 'resultado', texto: 'a\nb' });
  assert.equal(m.split('\n').length, 2, 'uma linha + o \\n final');
  assert.ok(m.startsWith(MARCA));
});
