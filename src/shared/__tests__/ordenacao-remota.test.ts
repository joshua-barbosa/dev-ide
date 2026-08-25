import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ordenarPorColuna, type Ordenavel } from '../remoto/ordenacao';

const e = (
  name: string,
  kind: Ordenavel['kind'],
  size: number | null = null,
  modifiedAt: number | null = null,
  owner?: string
): Ordenavel => ({ name, kind, size, modifiedAt, owner });

const LISTA: readonly Ordenavel[] = [
  e('zebra.txt', 'file', 10, 300, 'ana'),
  e('Ácido.txt', 'file', 999, 100, 'bruno'),
  e('var', 'folder'),
  e('sem-dono.txt', 'file', 5, 200),
  e('etc', 'folder'),
];

const nomes = (coluna: Parameters<typeof ordenarPorColuna>[1], dir: 'asc' | 'desc'): string[] =>
  ordenarPorColuna(LISTA, coluna, dir).map((x) => x.name);

test('pasta vem antes de arquivo em QUALQUER coluna e direção', () => {
  for (const coluna of ['nome', 'tamanho', 'modificado', 'dono'] as const) {
    for (const dir of ['asc', 'desc'] as const) {
      const ordenado = ordenarPorColuna(LISTA, coluna, dir);
      assert.deepEqual(
        ordenado.slice(0, 2).map((x) => x.kind),
        ['folder', 'folder'],
        `${coluna}/${dir}`
      );
    }
  }
});

test('por nome usa ordem de gente, e não de tabela ASCII', () => {
  // `Ácido` fica junto de `A`, e não depois de `z`.
  assert.deepEqual(nomes('nome', 'asc'), ['etc', 'var', 'Ácido.txt', 'sem-dono.txt', 'zebra.txt']);
});

test('inverter a coluna inverte só os arquivos entre si', () => {
  assert.deepEqual(nomes('nome', 'desc'), ['var', 'etc', 'zebra.txt', 'sem-dono.txt', 'Ácido.txt']);
});

test('por tamanho compara NÚMERO', () => {
  assert.deepEqual(
    nomes('tamanho', 'asc').slice(2),
    ['sem-dono.txt', 'zebra.txt', 'Ácido.txt']
  );
});

test('o que falta vai para o FIM nas duas direções', () => {
  // `sem-dono.txt` não tem dono; inverter não devia trazê-lo para a frente.
  assert.equal(nomes('dono', 'asc').at(-1), 'sem-dono.txt');
  assert.equal(nomes('dono', 'desc').at(-1), 'sem-dono.txt');
});

test('empate desempata pelo NOME, sempre crescente', () => {
  // Sem isto, ordenar duas vezes pela mesma coluna daria listas diferentes.
  const iguais = [e('b.txt', 'file', 7), e('a.txt', 'file', 7), e('c.txt', 'file', 7)];
  assert.deepEqual(
    ordenarPorColuna(iguais, 'tamanho', 'desc').map((x) => x.name),
    ['a.txt', 'b.txt', 'c.txt']
  );
});

test('ordenar não mexe na lista original', () => {
  const antes = LISTA.map((x) => x.name);
  ordenarPorColuna(LISTA, 'tamanho', 'desc');
  assert.deepEqual(LISTA.map((x) => x.name), antes);
});
