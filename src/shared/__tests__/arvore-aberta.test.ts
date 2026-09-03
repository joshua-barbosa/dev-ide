// O que sai da árvore ao desconectar UMA conexão.
//
// Nasceu do defeito que ele encontrou usando: desconectar uma derrubava a
// árvore de todas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chaveDoNo, expansoesSemAConexao, filhosSemAConexao,
} from '../connections/arvore-aberta';

test('as expansões da conexão saem, e as das outras ficam', () => {
  const abertos = new Set([
    'conn:servidor-1',
    `no:${chaveDoNo('servidor-1', ['escola-central'])}`,
    `no:${chaveDoNo('servidor-1', ['escola-central', 'alunos'])}`,
    'conn:banco-grande',
    `no:${chaveDoNo('banco-grande', ['banco'])}`,
  ]);
  assert.deepEqual(
    [...expansoesSemAConexao(abertos, 'servidor-1')].sort(),
    ['conn:banco-grande', `no:${chaveDoNo('banco-grande', ['banco'])}`]
  );
});

test('os filhos da conexão saem, e os das outras ficam', () => {
  const filhos = new Map([
    ['servidor-1', ['a']],
    [chaveDoNo('servidor-1', ['escola-central']), ['b']],
    ['banco-grande', ['c']],
    [chaveDoNo('banco-grande', ['banco']), ['d']],
  ]);
  assert.deepEqual(
    [...filhosSemAConexao(filhos, 'servidor-1').keys()].sort(),
    ['banco-grande', chaveDoNo('banco-grande', ['banco'])].sort()
  );
});

test('conexão de NOME PARECIDO não é afetada', () => {
  // `servidor-1` e `servidor-1b` compartilham prefixo: sem o separador na comparação,
  // desconectar a primeira apagaria a árvore da segunda — o mesmo defeito de
  // novo, menor e mais difícil de ver.
  const filhos = new Map([
    [chaveDoNo('servidor-1', ['x']), 1],
    [chaveDoNo('servidor-1b', ['x']), 2],
    ['servidor-1b', 3],
  ]);
  assert.deepEqual([...filhosSemAConexao(filhos, 'servidor-1').keys()].sort(), [
    'servidor-1b',
    chaveDoNo('servidor-1b', ['x']),
  ].sort());

  const abertos = new Set(['conn:servidor-1', 'conn:servidor-1b', `no:${chaveDoNo('servidor-1b', ['x'])}`]);
  assert.deepEqual(
    [...expansoesSemAConexao(abertos, 'servidor-1')].sort(),
    ['conn:servidor-1b', `no:${chaveDoNo('servidor-1b', ['x'])}`].sort()
  );
});

test('desconectar o que não está aberto não muda nada', () => {
  const filhos = new Map([['outra', 1]]);
  assert.deepEqual([...filhosSemAConexao(filhos, 'servidor-1').keys()], ['outra']);
});

test('a chave junta conexão e caminho sem ambiguidade', () => {
  // Sem separador, `a` + `bc` e `ab` + `c` dariam a mesma chave.
  assert.notEqual(chaveDoNo('a', ['bc']), chaveDoNo('ab', ['c']));
});
