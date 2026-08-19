import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINGUAGEM_TODAS, linguagensComSnippet, MAX_CORPO, MAX_PREFIXO, normalizarSnippets,
  rotuloDaLinguagem, snippetsDaLinguagem, validarSnippet, type Snippet,
} from '../snippets';

const s = (prefixo: string, linguagem = LINGUAGEM_TODAS): Snippet => ({
  id: `${linguagem}:${prefixo}`, nome: prefixo, prefixo, corpo: 'x', linguagem,
});

test('validar aceita e apara', () => {
  assert.deepEqual(
    validarSnippet({ nome: ' Log ', prefixo: ' log ', corpo: 'console.log($1);', linguagem: ' typescript ' }),
    { nome: 'Log', prefixo: 'log', corpo: 'console.log($1);', linguagem: 'typescript' }
  );
});

test('sem nome, o prefixo vira o nome', () => {
  assert.equal(validarSnippet({ prefixo: 'log', corpo: 'x' }).nome, 'log');
});

test('sem linguagem, vale em todas', () => {
  assert.equal(validarSnippet({ prefixo: 'log', corpo: 'x' }).linguagem, LINGUAGEM_TODAS);
});

test('prefixo com espaço é recusado — ele nunca dispararia', () => {
  // A conclusão do editor casa a palavra que está sendo digitada, e ela termina
  // no espaço: um prefixo "meu log" seria letra morta.
  assert.throws(() => validarSnippet({ prefixo: 'meu log', corpo: 'x' }), /espaços/);
});

test('prefixo ou corpo vazio é recusado', () => {
  assert.throws(() => validarSnippet({ prefixo: '', corpo: 'x' }), /prefixo/);
  assert.throws(() => validarSnippet({ prefixo: 'a', corpo: '   ' }), /vazio/);
});

test('texto absurdamente longo é recusado', () => {
  assert.throws(() => validarSnippet({ prefixo: 'a'.repeat(MAX_PREFIXO + 1), corpo: 'x' }), /prefixo passa/);
  assert.throws(() => validarSnippet({ prefixo: 'a', corpo: 'x'.repeat(MAX_CORPO + 1) }), /corpo passa/);
});

test('prefixo repetido conta só dentro da MESMA linguagem', () => {
  const existentes = [s('log', 'typescript')];
  // Mesmo prefixo, outra linguagem: legítimo.
  assert.doesNotThrow(() => validarSnippet({ prefixo: 'log', corpo: 'x', linguagem: 'php' }, existentes));
  assert.throws(
    () => validarSnippet({ prefixo: 'log', corpo: 'x', linguagem: 'typescript' }, existentes),
    /Já existe/
  );
});

test('o rótulo da linguagem coringa é legível', () => {
  assert.equal(rotuloDaLinguagem(LINGUAGEM_TODAS), 'todas as linguagens');
  assert.equal(rotuloDaLinguagem('php'), 'php');
});

// ---- fronteira tolerante ----

test('arquivo estragado vira lista vazia', () => {
  for (const entrada of [undefined, null, 7, 'x', {}]) {
    assert.deepEqual(normalizarSnippets(entrada), []);
  }
});

test('entradas incompletas são descartadas e as boas ficam', () => {
  const lista = normalizarSnippets([
    { id: 'a', prefixo: 'log', corpo: 'x' },
    { id: '', prefixo: 'sem id', corpo: 'x' },
    { id: 'c', prefixo: '  ', corpo: 'x' },
    { id: 'd', prefixo: 'sem corpo', corpo: '  ' },
    'texto solto',
  ]);
  assert.deepEqual(lista.map((x) => x.id), ['a']);
  assert.equal(lista[0]?.linguagem, LINGUAGEM_TODAS, 'sem linguagem vira coringa');
  assert.equal(lista[0]?.nome, 'log', 'sem nome vira o prefixo');
});

// ---- consulta ----

test('a linguagem recebe os dela E os coringa', () => {
  const todos = [s('log', 'typescript'), s('cab'), s('echo', 'php')];
  assert.deepEqual(
    snippetsDaLinguagem(todos, 'typescript').map((x) => x.prefixo).sort(),
    ['cab', 'log']
  );
  assert.deepEqual(snippetsDaLinguagem(todos, 'sql').map((x) => x.prefixo), ['cab']);
});

test('linguagensComSnippet não repete', () => {
  const todos = [s('a', 'php'), s('b', 'php'), s('c')];
  assert.deepEqual([...linguagensComSnippet(todos)].sort(), ['*', 'php']);
});
