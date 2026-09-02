// Aplicar uma renomeação de símbolo ao texto (T038).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aplicarTrocas, porArquivo, type LugarDeTroca } from '../renomear';

const em = (linha: number, coluna: number, caminho = '/a.ts'): LugarDeTroca =>
  ({ caminho, linha, coluna });

test('troca uma ocorrência', () => {
  assert.equal(aplicarTrocas('const abc = 1;', [em(1, 7)], 'abc', 'xyz'), 'const xyz = 1;');
});

test('DUAS na mesma linha, com nome MAIOR, não se atropelam', () => {
  // É o defeito clássico: trocar do começo para o fim empurra o alvo seguinte,
  // e a segunda troca cai no lugar errado. `abc` → `abcdef` cresce 3 caracteres.
  const antes = 'abc + abc';
  const depois = aplicarTrocas(antes, [em(1, 1), em(1, 7)], 'abc', 'abcdef');
  assert.equal(depois, 'abcdef + abcdef');
});

test('nome MENOR também não atropela', () => {
  const depois = aplicarTrocas('nomeLongo + nomeLongo', [em(1, 1), em(1, 13)], 'nomeLongo', 'n');
  assert.equal(depois, 'n + n');
});

test('várias linhas', () => {
  const antes = 'const abc = 1;\nconsole.log(abc);\nreturn abc;';
  const depois = aplicarTrocas(antes, [em(1, 7), em(2, 13), em(3, 8)], 'abc', 'total');
  assert.equal(depois, 'const total = 1;\nconsole.log(total);\nreturn total;');
});

test('o que NÃO bate é pulado, e o resto continua', () => {
  // O arquivo mudou entre a pergunta e a gravação. Trocar às cegas corromperia
  // o texto num lugar qualquer.
  const antes = 'const abc = 1;\nconst outro = 2;';
  const depois = aplicarTrocas(antes, [em(1, 7), em(2, 7)], 'abc', 'xyz');
  assert.equal(depois, 'const xyz = 1;\nconst outro = 2;');
});

test('linha que não existe não quebra', () => {
  assert.equal(aplicarTrocas('uma linha', [em(99, 1)], 'x', 'y'), 'uma linha');
});

test('sem lugares, o texto volta idêntico', () => {
  assert.equal(aplicarTrocas('nada muda', [], 'a', 'b'), 'nada muda');
});

test('agrupar por arquivo conta os lugares de cada um', () => {
  const g = porArquivo([em(1, 1, '/a.ts'), em(2, 1, '/a.ts'), em(1, 1, '/b.ts')]);
  assert.equal(g.size, 2);
  assert.equal(g.get('/a.ts')?.length, 2);
  assert.equal(g.get('/b.ts')?.length, 1);
});
