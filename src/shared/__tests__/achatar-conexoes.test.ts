// A árvore de grupos achatada numa lista.
//
// Existia em duas cópias — uma no `useConnections`, outra prestes a nascer na
// extensão. Duas cópias da mesma travessia é como uma delas passa a esquecer
// os subgrupos sem ninguém notar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achatarConexoes } from '../connections/achatar';
import type { GroupNode, PublicConnection } from '../contracts';

function conexao(id: string): PublicConnection {
  return { id, label: id, type: 'sqlite', group: '', readOnly: false } as PublicConnection;
}

const RAIZ: GroupNode = {
  name: '', path: '',
  connections: [conexao('a')],
  groups: [
    {
      name: 'ACME', path: 'ACME',
      connections: [conexao('b')],
      groups: [{ name: 'Bancos', path: 'ACME/Bancos', connections: [conexao('c')], groups: [] }],
    },
  ],
};

test('traz as conexões de todos os níveis', () => {
  assert.deepEqual(achatarConexoes(RAIZ).map((c) => c.id), ['a', 'b', 'c']);
});

test('grupo sem conexão nenhuma não atrapalha', () => {
  const vazio: GroupNode = { name: '', path: '', connections: [], groups: [] };
  assert.deepEqual(achatarConexoes(vazio), []);
});

test('a raiz vem ANTES dos subgrupos — a ordem da tela', () => {
  assert.equal(achatarConexoes(RAIZ)[0]?.id, 'a');
});
