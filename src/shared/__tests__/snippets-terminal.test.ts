import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  guardar,
  lerLista,
  MAX_SNIPPETS,
  remover,
  validarSnippet,
  type SnippetDeTerminal,
} from '../terminal/snippets';

const bom = { id: 'a', nome: 'Disk Usage', comando: 'du -h -d 1 | sort -h' };

test('o snippet do print do usuário passa inteiro', () => {
  const s = validarSnippet(bom);
  assert.equal(s.nome, 'Disk Usage');
  assert.equal(s.comando, 'du -h -d 1 | sort -h');
});

test('nome e comando são obrigatórios, e o erro DIZ qual falta', () => {
  assert.throws(() => validarSnippet({ comando: 'ls' }), /nome/);
  assert.throws(() => validarSnippet({ nome: 'x' }), /comando/);
  assert.throws(() => validarSnippet({ nome: '   ', comando: 'ls' }), /nome/);
});

test('NUL é recusado — ele corta a string no meio do caminho', () => {
  const comNul = `ls${String.fromCharCode(0)}; rm -rf /`;
  assert.throws(() => validarSnippet({ nome: 'x', comando: comNul }), /caractere/);
});

test('o id nasce quando não vem, e é preservado quando vem', () => {
  assert.equal(validarSnippet({ nome: 'x', comando: 'ls' }).id.length > 0, true);
  assert.equal(validarSnippet({ id: 'meu', nome: 'x', comando: 'ls' }).id, 'meu');
});

test('guardar acrescenta, e guardar de novo SUBSTITUI no lugar', () => {
  const um = validarSnippet(bom);
  const dois = validarSnippet({ id: 'b', nome: 'Logs', comando: 'tail -f x.log' });
  const lista = guardar(guardar([], um), dois);
  assert.deepEqual(lista.map((s) => s.id), ['a', 'b']);

  const editado = guardar(lista, { ...um, comando: 'du -sh *' });
  // No LUGAR: editar não pode mandar o snippet para o fim da lista.
  assert.deepEqual(editado.map((s) => s.id), ['a', 'b']);
  assert.equal(editado[0]?.comando, 'du -sh *');
});

test('o teto vale para snippet NOVO, e não impede editar os que já existem', () => {
  const cheia: SnippetDeTerminal[] = Array.from({ length: MAX_SNIPPETS }, (_, i) => ({
    id: `s${i}`,
    nome: `n${i}`,
    comando: 'ls',
  }));
  assert.throws(() => guardar(cheia, { id: 'novo', nome: 'x', comando: 'ls' }), /Limite/);
  // Editar um dos existentes continua funcionando — senão a lista cheia vira
  // uma lista congelada.
  assert.equal(guardar(cheia, { id: 's0', nome: 'n0', comando: 'pwd' })[0]?.comando, 'pwd');
});

test('remover tira só o pedido', () => {
  const lista = [
    { id: 'a', nome: 'A', comando: 'ls' },
    { id: 'b', nome: 'B', comando: 'pwd' },
  ];
  assert.deepEqual(remover(lista, 'a').map((s) => s.id), ['b']);
  assert.equal(remover(lista, 'zzz').length, 2);
});

test('a leitura é tolerante: item torto sai, vizinhos ficam', () => {
  const lista = lerLista([bom, { nome: '' }, null, 'texto', { id: 'c', nome: 'C', comando: 'pwd' }]);
  assert.deepEqual(lista.map((s) => s.id), ['a', 'c']);
  assert.deepEqual(lerLista('nem é lista'), []);
});
