import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICONE_DE_ARQUIVO, iconeDeArquivo } from '../editor/arquivos';

test('linguagem conhecida usa o ícone da linguagem', () => {
  assert.notEqual(iconeDeArquivo('/p/a.ts', 'typescript'), ICONE_DE_ARQUIVO);
});

test('o que não se reconhece sai como papel em branco, e não vazio', () => {
  assert.equal(iconeDeArquivo('/p/coisa.xyzw'), ICONE_DE_ARQUIVO);
});


test('arquivo oculto tem ícone próprio, e não papel em branco', () => {
  // Passaram a aparecer na árvore na spec 029; antes disso nenhum chegava aqui.
  assert.equal(iconeDeArquivo('/p/.gitignore'), 'vscode-icons:file-type-git');
  assert.equal(iconeDeArquivo('/p/.env'), 'vscode-icons:file-type-config');
  assert.equal(iconeDeArquivo('/p/.editorconfig'), 'vscode-icons:file-type-config');
});

test('as variações do .env caem todas no mesmo ícone', () => {
  // A extensão de cada uma é diferente; o tipo é o mesmo.
  for (const nome of ['.env.example', '.env.local', '.env.production']) {
    assert.equal(iconeDeArquivo(`/p/${nome}`), 'vscode-icons:file-type-config', nome);
  }
});
