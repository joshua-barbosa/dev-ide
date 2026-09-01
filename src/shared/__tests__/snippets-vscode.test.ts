// Snippets no formato do VS Code (T017, T018).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINGUAGEM_TODAS, type Snippet } from '../snippets';
import { lerSnippetsDoVsCode, linguagemDoArquivo, semOsRepetidos } from '../snippets-vscode';

test('lê o formato do VS Code, com o corpo em lista', () => {
  const [s] = lerSnippetsDoVsCode({
    Log: { prefix: 'log', body: ["console.log('$1');", '$0'], description: 'imprime' },
  }, 'javascript');
  assert.equal(s?.nome, 'Log', 'a CHAVE é o nome');
  assert.equal(s?.prefixo, 'log');
  assert.equal(s?.corpo, "console.log('$1');\n$0", 'a lista vira linhas');
  assert.equal(s?.linguagem, 'javascript');
});

test('corpo em texto único também vale', () => {
  const [s] = lerSnippetsDoVsCode({ X: { prefix: 'x', body: 'linha só' } });
  assert.equal(s?.corpo, 'linha só');
});

test('os marcadores do VS Code atravessam sem conversão', () => {
  // São os mesmos do Monaco: `$1`, `${1:valor}`, `$0`, e o espelho do `$1`
  // repetido. Converter seria inventar um problema.
  const [s] = lerSnippetsDoVsCode({ F: { prefix: 'f', body: 'def ${1:nome}($2):\n    $1($2)\n$0' } });
  assert.equal(s?.corpo, 'def ${1:nome}($2):\n    $1($2)\n$0');
});

test('entrada ruim é descartada UMA A UMA', () => {
  // Recusar o arquivo inteiro por causa de um snippet torto faria perder os
  // outros vinte que estavam certos.
  const r = lerSnippetsDoVsCode({
    'sem prefixo': { body: 'x' },
    'sem corpo': { prefix: 'a' },
    'prefixo com espaço': { prefix: 'a b', body: 'x' },
    'corpo vazio': { prefix: 'c', body: ['   '] },
    'nao e objeto': 'texto',
    bom: { prefix: 'ok', body: 'x' },
  });
  assert.deepEqual(r.map((s) => s.prefixo), ['ok']);
});

test('arquivo estragado devolve lista vazia', () => {
  for (const bruto of [null, 7, 'x', [], undefined]) {
    assert.deepEqual(lerSnippetsDoVsCode(bruto), []);
  }
});

test('prefixo em LISTA fica com o primeiro', () => {
  const [s] = lerSnippetsDoVsCode({ X: { prefix: ['um', 'dois'], body: 'x' } });
  assert.equal(s?.prefixo, 'um');
});

test('linha que não é texto some do corpo, em vez de virar número', () => {
  const [s] = lerSnippetsDoVsCode({ X: { prefix: 'x', body: ['a', 7, 'b'] } });
  assert.equal(s?.corpo, 'a\nb');
});

test('nome vazio cai no prefixo', () => {
  const [s] = lerSnippetsDoVsCode({ '  ': { prefix: 'p', body: 'x' } });
  assert.equal(s?.nome, 'p');
});

// ---- de onde vem a linguagem ----

test('a linguagem sai do NOME do arquivo', () => {
  assert.equal(linguagemDoArquivo('javascript.json'), 'javascript');
  assert.equal(linguagemDoArquivo('/casa/.config/Code/User/snippets/python.json'), 'python');
});

test('`.code-snippets` vale para todas as linguagens', () => {
  assert.equal(linguagemDoArquivo('meus.code-snippets'), LINGUAGEM_TODAS);
  assert.equal(linguagemDoArquivo('sem-ponto'), 'sem-ponto');
});

test('`scope` com UMA linguagem vence o padrão', () => {
  const [s] = lerSnippetsDoVsCode({ X: { prefix: 'x', body: 'y', scope: 'sql' } }, 'javascript');
  assert.equal(s?.linguagem, 'sql');
});

test('`scope` com VÁRIAS cai em todas', () => {
  // Esta IDE guarda uma linguagem por snippet; escolher a primeira da lista
  // esconderia o snippet nas outras.
  const [s] = lerSnippetsDoVsCode({ X: { prefix: 'x', body: 'y', scope: 'sql,python' } });
  assert.equal(s?.linguagem, LINGUAGEM_TODAS);
});

// ---- não importar duas vezes ----

const existente: Snippet = {
  id: '1', nome: 'Log', prefixo: 'log', corpo: 'x', linguagem: 'javascript',
};

test('o que já existe não entra de novo', () => {
  const novos = lerSnippetsDoVsCode({
    Log: { prefix: 'log', body: 'outro corpo' },
    Novo: { prefix: 'novo', body: 'x' },
  }, 'javascript');
  assert.deepEqual(semOsRepetidos(novos, [existente]).map((s) => s.prefixo), ['novo']);
});

test('o mesmo prefixo em OUTRA linguagem entra', () => {
  const novos = lerSnippetsDoVsCode({ Log: { prefix: 'log', body: 'x' } }, 'python');
  assert.equal(semOsRepetidos(novos, [existente]).length, 1);
});

test('o mesmo prefixo repetido no arquivo entra UMA vez', () => {
  const novos = [
    { nome: 'a', prefixo: 'p', corpo: 'x', linguagem: 'sql' },
    { nome: 'b', prefixo: 'p', corpo: 'y', linguagem: 'sql' },
  ];
  assert.equal(semOsRepetidos(novos, []).length, 1);
});

test('mudar o NOME não faz dele outro snippet', () => {
  const novos = [{ nome: 'Outro nome', prefixo: 'log', corpo: 'x', linguagem: 'javascript' }];
  assert.deepEqual(semOsRepetidos(novos, [existente]), []);
});
