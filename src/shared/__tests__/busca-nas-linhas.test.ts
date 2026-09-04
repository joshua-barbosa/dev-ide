// A busca DENTRO do resultado que já veio.
//
// É diferente do filtro por coluna, que reescreve o `WHERE` e volta ao banco:
// esta olha só o que está na tela. Existe porque é o gesto de quem já rodou a
// consulta e quer achar uma linha no meio das 500 — sem pagar outra viagem, e
// sem precisar saber escrever o filtro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasQueCasam, TERMO_VAZIO } from '../grade/busca-nas-linhas';

const LINHAS: readonly (readonly unknown[])[] = [
  [1, 'Turma A', 30, null],
  [2, 'Turma B', 25, 'manhã'],
  [3, 'turma c', 30, 'TARDE'],
];

test('termo vazio devolve TUDO, e o mesmo array', () => {
  assert.equal(linhasQueCasam(LINHAS, ''), LINHAS);
  assert.equal(linhasQueCasam(LINHAS, '   '), LINHAS);
  assert.equal(TERMO_VAZIO, '');
});

test('acha em qualquer coluna, sem ligar para maiúscula', () => {
  assert.deepEqual(linhasQueCasam(LINHAS, 'turma'), LINHAS);
  assert.deepEqual(linhasQueCasam(LINHAS, 'TURMA B'), [LINHAS[1]]);
  assert.deepEqual(linhasQueCasam(LINHAS, 'tarde'), [LINHAS[2]]);
});

test('número casa pelo texto dele — é o que está escrito na célula', () => {
  assert.deepEqual(linhasQueCasam(LINHAS, '30'), [LINHAS[0], LINHAS[2]]);
});

test('nada casa devolve lista vazia, e não a lista inteira', () => {
  assert.deepEqual(linhasQueCasam(LINHAS, 'zebra'), []);
});

test('NULL não vira a palavra "null" — buscar null não traz a linha da célula vazia', () => {
  // Se `null` virasse texto, procurar por "nul" acharia toda linha com célula
  // vazia. Quem quer isso usa o filtro por coluna, que fala com o banco.
  assert.deepEqual(linhasQueCasam(LINHAS, 'null'), []);
});

test('o espaço nas pontas do termo não conta', () => {
  assert.deepEqual(linhasQueCasam(LINHAS, '  Turma B  '), [LINHAS[1]]);
});
