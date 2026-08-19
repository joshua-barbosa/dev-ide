import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dicaDePosicao, interpretarPosicao } from '../editor/posicao';

const EM = 100; // um arquivo de 100 linhas

test('só o número vai para o começo da linha', () => {
  assert.deepEqual(interpretarPosicao('12', EM), { linha: 12, coluna: 1 });
});

test('linha:coluna, como no VS Code', () => {
  assert.deepEqual(interpretarPosicao('12:5', EM), { linha: 12, coluna: 5 });
});

test('a vírgula também serve — é o que a barra de status mostra', () => {
  // "Ln 12, Col 5" é o que está na tela, e é o que a mão copia de lá.
  assert.deepEqual(interpretarPosicao('12,5', EM), { linha: 12, coluna: 5 });
});

test('espaço em volta não atrapalha', () => {
  assert.deepEqual(interpretarPosicao('  12 : 5  ', EM), { linha: 12, coluna: 5 });
});

test('linha maior que o arquivo VAI PARA O FIM, e não vira erro', () => {
  // Quem digita 9999 está dizendo "o final". Recusar seria tecnicamente certo
  // e praticamente inútil.
  assert.deepEqual(interpretarPosicao('9999', EM), { linha: 100, coluna: 1 });
  assert.deepEqual(interpretarPosicao('9999:3', EM), { linha: 100, coluna: 3 });
});

test('arquivo vazio ainda tem a linha 1', () => {
  assert.deepEqual(interpretarPosicao('5', 0), { linha: 1, coluna: 1 });
});

test('o que não dá para entender devolve null', () => {
  for (const bruto of [
    '',
    '   ',
    'abc',
    '12:abc',
    'abc:12',
    '1.5',
    '-3',
    '0',
    '12:0',
    '1:2:3',
    '12:',
    ':5',
  ]) {
    assert.equal(interpretarPosicao(bruto, EM), null, bruto);
  }
});

test('a coluna NÃO é limitada pelo número de linhas', () => {
  // Limitar coluna exigiria saber o tamanho daquela linha, que este módulo não
  // conhece — e o editor já para no fim da linha sozinho.
  assert.deepEqual(interpretarPosicao('10:500', EM), { linha: 10, coluna: 500 });
});

test('a dica diz o alcance do arquivo aberto', () => {
  assert.match(dicaDePosicao(42), /1 e 42/);
  assert.match(dicaDePosicao(0), /1 e 1/, 'arquivo vazio não pode dizer "entre 1 e 0"');
});
