import assert from 'node:assert/strict';
import test from 'node:test';
import { modoDoCofre, validarSenhaNova } from '../cofre';

// Numa máquina nova o cofre NÃO EXISTE. Pedir para destrancá-lo foi o defeito
// que travou a extensão no notebook dele: o motor responde "Cofre não
// encontrado", e o Salvar do formulário esperava para sempre por um diálogo
// que ninguém desenhava.

test('cofre ausente pede CRIAR — destrancar o que não existe só dá erro', () => {
  assert.equal(modoDoCofre({ exists: false, unlocked: false }), 'criar');
});

test('cofre existente e trancado pede destrancar', () => {
  assert.equal(modoDoCofre({ exists: true, unlocked: false }), 'destrancar');
});

test('cofre aberto não pede nada', () => {
  assert.equal(modoDoCofre({ exists: true, unlocked: true }), 'pronto');
});

test('senha nova vazia é recusada antes de ir ao motor', () => {
  assert.match(validarSenhaNova('', '') ?? '', /vazia/);
});

test('confirmação diferente é recusada — senha trocada com erro de digitação tranca o cofre para sempre', () => {
  assert.match(validarSenhaNova('abcd1234', 'abcd1235') ?? '', /não batem/);
});

test('senha e confirmação iguais passam', () => {
  assert.equal(validarSenhaNova('abcd1234', 'abcd1234'), null);
});
