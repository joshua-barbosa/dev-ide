// A trilha acima do editor (T075).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trilha, trilhaDoCaminho, trilhaDoSimbolo, type SimboloDaTrilha } from '../breadcrumb';

const RAIZ = '/casa/projeto';

test('a raiz NÃO entra na trilha', () => {
  // Ela é a mesma em toda trilha; repeti-la ocuparia a barra sem informar nada.
  const t = trilhaDoCaminho('/casa/projeto/src/ui/App.tsx', RAIZ, 'linux');
  assert.deepEqual(t.map((d) => d.rotulo), ['src', 'ui', 'App.tsx']);
  assert.equal(t.at(-1)?.tipo, 'arquivo');
  assert.equal(t[0]?.tipo, 'pasta');
});

test('barra sobrando na raiz não muda nada', () => {
  assert.deepEqual(
    trilhaDoCaminho('/casa/projeto/a.ts', '/casa/projeto/', 'linux').map((d) => d.rotulo),
    ['a.ts']
  );
});

test('arquivo fora da raiz aparece inteiro', () => {
  // Aberto por caminho absoluto, de outro lugar: cortar o começo daria um
  // caminho que não existe.
  const t = trilhaDoCaminho('/outro/lugar/x.ts', RAIZ, 'linux');
  assert.deepEqual(t.map((d) => d.rotulo), ['outro', 'lugar', 'x.ts']);
});

// ---------------------------------------------------------------------------
// Os símbolos
// ---------------------------------------------------------------------------

const SIMBOLOS: readonly SimboloDaTrilha[] = [
  { name: 'TabelaHost', kind: 'class', line: 10, lineEnd: 100 },
  { name: 'carregarPagina', kind: 'method', line: 20, lineEnd: 40 },
  { name: 'ordenar', kind: 'method', line: 50, lineEnd: 60 },
  { name: 'ajudante', kind: 'function', line: 120, lineEnd: 130 },
];

test('a trilha vai do mais EXTERNO para o mais interno', () => {
  const t = trilhaDoSimbolo(SIMBOLOS, 25);
  assert.deepEqual(t.map((d) => d.rotulo), ['TabelaHost', 'carregarPagina']);
});

test('fora de qualquer símbolo, a trilha de símbolo é vazia', () => {
  assert.deepEqual(trilhaDoSimbolo(SIMBOLOS, 5), []);
  assert.deepEqual(trilhaDoSimbolo(SIMBOLOS, 200), []);
});

test('num símbolo de nível único, só ele aparece', () => {
  assert.deepEqual(trilhaDoSimbolo(SIMBOLOS, 125).map((d) => d.rotulo), ['ajudante']);
});

test('o degrau do símbolo leva a linha, para poder clicar', () => {
  const t = trilhaDoSimbolo(SIMBOLOS, 25);
  assert.equal(t[1]?.linha, 20);
  assert.equal(t[1]?.tipo, 'method');
});

test('sem `linhaFim`, o fim é o começo do próximo', () => {
  // A aproximação está documentada: ela erra em código solto depois do último
  // `}`, e a alternativa custaria uma varredura por movimento de cursor.
  const sem: readonly SimboloDaTrilha[] = [
    { name: 'primeira', kind: 'function', line: 1 },
    { name: 'segunda', kind: 'function', line: 10 },
  ];
  assert.deepEqual(trilhaDoSimbolo(sem, 5).map((d) => d.rotulo), ['primeira']);
  assert.deepEqual(trilhaDoSimbolo(sem, 15).map((d) => d.rotulo), ['segunda']);
});

test('a lista pode vir fora de ordem', () => {
  // `server/symbols.ts` a devolve plana, e a ordem não é garantida.
  const bagunca = [...SIMBOLOS].reverse();
  assert.deepEqual(trilhaDoSimbolo(bagunca, 25).map((d) => d.rotulo), [
    'TabelaHost',
    'carregarPagina',
  ]);
});

test('a trilha inteira põe o símbolo DEPOIS do arquivo', () => {
  // É a ordem que se erra ao juntar as duas metades.
  const t = trilha('/casa/projeto/src/T.tsx', RAIZ, SIMBOLOS, 25, 'linux');
  assert.deepEqual(t.map((d) => d.rotulo), ['src', 'T.tsx', 'TabelaHost', 'carregarPagina']);
});

test('sem símbolo nenhum, sobra o caminho', () => {
  const t = trilha('/casa/projeto/leia.md', RAIZ, [], 1, 'linux');
  assert.deepEqual(t.map((d) => d.rotulo), ['leia.md']);
});

test('a trilha usa só os símbolos DESTE arquivo', () => {
  // A lista do painel é do projeto inteiro. Sem o filtro, a classe de outro
  // arquivo apareceria só por ter uma linha com o mesmo número.
  const deVarios: readonly SimboloDaTrilha[] = [
    { name: 'DaquiMesmo', kind: 'class', line: 10, lineEnd: 100, file: '/casa/projeto/a.ts' },
    { name: 'DeOutro', kind: 'class', line: 10, lineEnd: 100, file: '/casa/projeto/b.ts' },
  ];
  const t = trilha('/casa/projeto/a.ts', RAIZ, deVarios, 20, 'linux');
  assert.deepEqual(t.map((d) => d.rotulo), ['a.ts', 'DaquiMesmo']);
});

test('no Windows a trilha separa por `\\` — senão mostra o caminho inteiro (D223)', () => {
  const t = trilhaDoCaminho('C:\\casa\\projeto\\src\\App.tsx', 'C:\\casa\\projeto', 'win32');
  assert.deepEqual(t.map((d) => d.rotulo), ['src', 'App.tsx']);
});

test('no Linux a contrabarra continua sendo nome de arquivo', () => {
  const t = trilhaDoCaminho('/casa/projeto/a\\b.ts', '/casa/projeto', 'linux');
  assert.deepEqual(t.map((d) => d.rotulo), ['a\\b.ts']);
});
