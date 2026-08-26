import assert from 'node:assert/strict';
import test from 'node:test';
import { ehBinario, lerTabular, separadorDe, visualizadorDe } from '../editor/visualizadores';

test('cada extensão vai para o visualizador certo', () => {
  assert.equal(visualizadorDe('a.png'), 'imagem');
  assert.equal(visualizadorDe('a.PDF'), 'pdf');
  assert.equal(visualizadorDe('a.csv'), 'csv');
  assert.equal(visualizadorDe('a.tsv'), 'csv');
  assert.equal(visualizadorDe('a.sqlbook'), 'caderno');
  assert.equal(visualizadorDe('a.ts'), 'texto');
  assert.equal(visualizadorDe('sem-extensao'), 'texto');
});

test('SVG é imagem — e entra como `<img>`, que não executa script', () => {
  assert.equal(visualizadorDe('desenho.svg'), 'imagem');
});

test('só imagem e PDF precisam vir como bytes', () => {
  assert.equal(ehBinario('imagem'), true);
  assert.equal(ehBinario('pdf'), true);
  // CSV É texto: ler como bytes seria trabalho a mais para o mesmo resultado.
  assert.equal(ehBinario('csv'), false);
  assert.equal(ehBinario('texto'), false);
});

test('o separador vem do CONTEÚDO, não da extensão', () => {
  // "CSV" do Excel em português usa `;`. Ler com `,` daria uma coluna só.
  assert.equal(separadorDe('a.csv', 'nome;idade;cidade'), ';');
  assert.equal(separadorDe('a.csv', 'nome,idade,cidade'), ',');
  assert.equal(separadorDe('a.tsv', 'nome,idade'), '\t');
});

test('separador DENTRO de aspas não conta', () => {
  // `"Sobrenome, Nome"` tem uma vírgula que é conteúdo.
  assert.equal(separadorDe('a.csv', '"Sobrenome, Nome";idade'), ';');
});

test('lê campos com aspas, aspa dobrada e quebra de linha dentro', () => {
  const { linhas } = lerTabular('a,b\n"x,1","diz ""oi"""\n', ',');
  assert.deepEqual(linhas, [['a', 'b'], ['x,1', 'diz "oi"']]);
});

test('quebra de linha DENTRO de aspas não termina a linha', () => {
  const { linhas } = lerTabular('a,b\n"primeira\nsegunda",2\n', ',');
  assert.equal(linhas.length, 2);
  assert.equal(linhas[1]?.[0], 'primeira\nsegunda');
});

test('`\\r\\n` não vira caractere no dado', () => {
  const { linhas } = lerTabular('a,b\r\n1,2\r\n', ',');
  assert.deepEqual(linhas, [['a', 'b'], ['1', '2']]);
});

test('a última linha sem quebra no fim também conta', () => {
  const { linhas } = lerTabular('a,b\n1,2', ',');
  assert.equal(linhas.length, 2);
});

test('o teto corta e avisa — um CSV de milhões de linhas mataria a aba', () => {
  const grande = Array.from({ length: 50 }, (_, i) => `${i},x`).join('\n');
  const r = lerTabular(grande, ',', 10);
  assert.equal(r.linhas.length, 10);
  assert.equal(r.truncado, true);
});

test('vazio devolve nada, e não uma linha em branco', () => {
  assert.deepEqual(lerTabular('', ',').linhas, []);
});
