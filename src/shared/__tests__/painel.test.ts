import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABAS_DO_PAINEL, ehAbaDoPainel, ehRepeticao, MAX_PROBLEMAS, registrarProblema,
  type Problema,
} from '../painel';

const problema = (mensagem: string, i = 0): Problema => ({
  id: `p${i}`,
  origem: 'execução',
  mensagem,
  quando: '2026-08-18T12:00:00.000Z',
});

test('as três abas são Output, Problems e Terminal — sem Debug Console', () => {
  assert.deepEqual(ABAS_DO_PAINEL.map(([id]) => id), ['output', 'problems', 'terminal']);
  // Ele pressupõe depurador, e a IDE decidiu não ter um.
  assert.equal(ehAbaDoPainel('debug'), false);
});

test('ehAbaDoPainel reconhece só o que existe', () => {
  assert.equal(ehAbaDoPainel('output'), true);
  assert.equal(ehAbaDoPainel('inventada'), false);
});

test('o mais novo fica em primeiro', () => {
  const lista = registrarProblema(registrarProblema([], problema('a', 1)), problema('b', 2));
  assert.deepEqual(lista.map((p) => p.mensagem), ['b', 'a']);
});

test('registrar não muta a lista anterior', () => {
  const antes = registrarProblema([], problema('a'));
  registrarProblema(antes, problema('b', 2));
  assert.equal(antes.length, 1);
});

test('a lista tem teto — um laço de erro não pode engasgar a página', () => {
  let lista: readonly Problema[] = [];
  for (let i = 0; i < MAX_PROBLEMAS + 50; i += 1) lista = registrarProblema(lista, problema(`m${i}`, i));

  assert.equal(lista.length, MAX_PROBLEMAS);
  assert.equal(lista[0]?.mensagem, `m${MAX_PROBLEMAS + 49}`, 'o mais novo sobrevive');
});

test('ehRepeticao pega o mesmo erro chegando por dois caminhos', () => {
  const lista = registrarProblema([], problema('conexão recusada'));
  assert.equal(ehRepeticao(lista, 'execução', 'conexão recusada'), true);
  assert.equal(ehRepeticao(lista, 'conexão', 'conexão recusada'), false, 'origem diferente conta');
  assert.equal(ehRepeticao(lista, 'execução', 'outra coisa'), false);
  assert.equal(ehRepeticao([], 'execução', 'qualquer'), false);
});
