import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lerPadroes, montarFiltro, passaNoFiltro, pastaVaiSerVarrida, SEM_FILTRO,
} from '../busca-filtro';

test('sem filtro nenhum, tudo passa', () => {
  assert.equal(passaNoFiltro('src/a.ts', SEM_FILTRO), true);
  assert.equal(pastaVaiSerVarrida('node_modules', SEM_FILTRO), true);
});

test('padrões separados por vírgula, com espaço em volta', () => {
  assert.deepEqual(lerPadroes(' *.ts , *.tsx '), ['*.ts', '*.tsx']);
  assert.deepEqual(lerPadroes(''), []);
  assert.deepEqual(lerPadroes('  ,  '), []);
});

test('`include` limita: o que não casa fica de fora', () => {
  const f = montarFiltro('*.ts', '');
  assert.equal(passaNoFiltro('src/a.ts', f), true);
  assert.equal(passaNoFiltro('src/a.js', f), false);
});

test('a gramática é a do `.gitignore` — `*` NÃO atravessa `/`', () => {
  // É a razão de reusar o compilador: duas gramáticas para a mesma coisa é o
  // defeito. `src/*.ts` não pode casar `src/a/b.ts`.
  const f = montarFiltro('src/*.ts', '');
  assert.equal(passaNoFiltro('src/a.ts', f), true);
  assert.equal(passaNoFiltro('src/sub/a.ts', f), false);
});

test('`**` atravessa', () => {
  const f = montarFiltro('src/**/*.ts', '');
  assert.equal(passaNoFiltro('src/sub/fundo/a.ts', f), true);
});

test('`exclude` vence `include` — é "tudo isto, MENOS aquilo"', () => {
  const f = montarFiltro('**/*.ts', '**/*.test.ts');
  assert.equal(passaNoFiltro('src/a.ts', f), true);
  assert.equal(passaNoFiltro('src/a.test.ts', f), false);
});

test('só o `exclude` poda PASTA', () => {
  // Um `include` de `*.ts` não pode podar `src/`, senão a varredura nunca
  // chegaria aos `.ts` lá dentro.
  const f = montarFiltro('*.ts', 'dist');
  assert.equal(pastaVaiSerVarrida('src', f), true);
  assert.equal(pastaVaiSerVarrida('dist', f), false);
});

test('`exclude` sozinho tira o que casa e deixa o resto', () => {
  const f = montarFiltro('', 'node_modules,dist');
  assert.equal(passaNoFiltro('src/a.ts', f), true);
  assert.equal(passaNoFiltro('dist/a.js', f), false);
  assert.equal(passaNoFiltro('node_modules/x/a.js', f), false);
});

test('padrão inválido não derruba a busca — vira nada', () => {
  const f = montarFiltro('   ', '  ');
  assert.equal(passaNoFiltro('qualquer/coisa.txt', f), true);
});
