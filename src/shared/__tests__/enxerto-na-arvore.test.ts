// Onde os filhos de uma pasta entram na árvore (D223).
//
// Isto morava dentro do hook `usePasta`, sem teste, e era onde estava o defeito
// que ele viu como "abre fecha abre fecha freneticamente" no Windows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enxertar, enxertarNasRaizes, type NoDaArvore, type RaizComArvore } from '../enxerto-na-arvore';

const dir = (path: string, children?: NoDaArvore[]): NoDaArvore =>
  children === undefined ? { path, type: 'dir' } : { path, type: 'dir', children };
const arq = (path: string): NoDaArvore => ({ path, type: 'file' });

test('enxerta no nó certo, em qualquer profundidade', () => {
  const antes = [dir('/r/a', [dir('/r/a/b')]), arq('/r/x.ts')];
  const depois = enxertar(antes, '/r/a/b', [arq('/r/a/b/c.ts')], 'linux');
  const a = depois[0] as NoDaArvore;
  assert.deepEqual(a.children?.[0]?.children?.map((n) => n.path), ['/r/a/b/c.ts']);
});

test('os ramos que não mudam são os MESMOS objetos — é o que evita redesenhar tudo', () => {
  const intocado = arq('/r/x.ts');
  const depois = enxertar([dir('/r/a', [dir('/r/a/b')]), intocado], '/r/a/b', [], 'linux');
  assert.equal(depois[1], intocado);
});

test('no Windows o enxerto acha o nó — o defeito era a barra fixa', () => {
  const antes = [dir('C:\\r\\a', [dir('C:\\r\\a\\b')])];
  const depois = enxertar(antes, 'C:\\r\\a\\b', [arq('C:\\r\\a\\b\\c.ts')], 'win32');
  const a = depois[0] as NoDaArvore;
  assert.deepEqual(a.children?.[0]?.children?.map((n) => n.path), ['C:\\r\\a\\b\\c.ts']);
});

const raizes = (...ps: string[]): RaizComArvore[] =>
  ps.map((pasta) => ({ pasta, arvore: [dir(`${pasta}sub`)] }));

test('a raiz É a árvore: recarregá-la troca a árvore inteira', () => {
  const r = [{ pasta: '/r', arvore: [arq('/r/velho.ts')] }];
  const depois = enxertarNasRaizes(r, '/r', [arq('/r/novo.ts')], 'linux');
  assert.deepEqual(depois[0]?.arvore.map((n) => n.path), ['/r/novo.ts']);
});

test('com várias raízes, ganha a de prefixo mais LONGO', () => {
  // `/r/dentro` aberta junto com `/r`: uma pasta dela não pode cair na de fora.
  const r = [
    { pasta: '/r', arvore: [dir('/r/dentro')] },
    { pasta: '/r/dentro', arvore: [dir('/r/dentro/a')] },
  ];
  const depois = enxertarNasRaizes(r, '/r/dentro/a', [arq('/r/dentro/a/x.ts')], 'linux');
  assert.equal(depois[0]?.arvore[0]?.children, undefined, 'a raiz de fora não muda');
  assert.deepEqual(
    depois[1]?.arvore[0]?.children?.map((n) => n.path), ['/r/dentro/a/x.ts']
  );
});

test('no Windows uma subpasta encontra a raiz dela', () => {
  const r = [{ pasta: 'C:\\r', arvore: [dir('C:\\r\\a')] }];
  const depois = enxertarNasRaizes(r, 'C:\\r\\a', [arq('C:\\r\\a\\x.ts')], 'win32');
  assert.deepEqual(depois[0]?.arvore[0]?.children?.map((n) => n.path), ['C:\\r\\a\\x.ts']);
});

test('caminho de fora de todas as raízes não muda nada', () => {
  const r = raizes('/r/');
  assert.equal(enxertarNasRaizes(r, '/outro/x', [], 'linux'), r);
});
