// O que o "Abrir com…" pediu, lido da URL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pedidoDaUrl } from '../../ui/aberturaPelaUrl';

test('pasta sozinha é um pedido válido', () => {
  assert.deepEqual(pedidoDaUrl('?abrirPasta=%2Fcasa%2Fprojeto'), { pasta: '/casa/projeto' });
});

test('pasta e arquivo vêm juntos quando ele abriu um arquivo', () => {
  assert.deepEqual(
    pedidoDaUrl('?abrirPasta=%2Fcasa%2Fp&abrirArquivo=%2Fcasa%2Fp%2Fmain.ts'),
    { pasta: '/casa/p', arquivo: '/casa/p/main.ts' }
  );
});

test('caminho com espaço e acento volta inteiro', () => {
  assert.equal(
    pedidoDaUrl('?abrirPasta=%2Fcasa%2Fmeu%20c%C3%B3digo')?.pasta,
    '/casa/meu código'
  );
});

test('sem pedido, é nulo — e não uma pasta vazia', () => {
  assert.equal(pedidoDaUrl(''), null);
  assert.equal(pedidoDaUrl('?outra=coisa'), null);
  assert.equal(pedidoDaUrl('?abrirPasta='), null);
});

test('arquivo vazio não vira um arquivo chamado ""', () => {
  assert.deepEqual(pedidoDaUrl('?abrirPasta=%2Fa&abrirArquivo='), { pasta: '/a' });
});
