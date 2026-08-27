// O filtro da árvore com mais de um critério (T112, spec 069).
//
// A parte que erra na prática é ler o que o usuário digitou: "10 MB" tem
// espaço, "1,5 GB" tem vírgula, e "10" sozinho é ambíguo. Errar aqui filtra
// tabela demais ou de menos — e em silêncio, que é o pior jeito.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FILTRO_VAZIO,
  estaVazio,
  explicarFiltro,
  interpretarData,
  interpretarTamanho,
  normalizarFiltro,
} from '../tree/filtro-da-arvore';

test('tamanho aceita unidade, espaço e vírgula', () => {
  assert.equal(interpretarTamanho('10'), 10);
  assert.equal(interpretarTamanho('10K'), 10 * 1024);
  assert.equal(interpretarTamanho('10 MB'), 10 * 1024 * 1024);
  assert.equal(interpretarTamanho('1,5 GB'), 1.5 * 1024 * 1024 * 1024);
  assert.equal(interpretarTamanho('1.5gb'), 1.5 * 1024 * 1024 * 1024);
  assert.equal(interpretarTamanho('  2 t  '), 2 * 1024 ** 4);
});

test('tamanho ilegível é nulo, e nunca zero', () => {
  // Zero filtraria TUDO — "maior que 0 bytes" passa em qualquer tabela, e o
  // usuário concluiria que o filtro não funciona.
  assert.equal(interpretarTamanho(''), null);
  assert.equal(interpretarTamanho('grande'), null);
  assert.equal(interpretarTamanho('-5 MB'), null);
  assert.equal(interpretarTamanho('10 XB'), null);
});

test('data aceita o dia e o relativo, com o agora vindo de fora', () => {
  const agora = new Date('2026-08-27T12:00:00Z');
  assert.equal(interpretarData('2026-01-15', agora), '2026-01-15');
  assert.equal(interpretarData('30d', agora), '2026-07-28');
  assert.equal(interpretarData('1d', agora), '2026-08-26');
  assert.equal(interpretarData('', agora), null);
  assert.equal(interpretarData('ontem', agora), null);
  assert.equal(interpretarData('2026-13-01', agora), null);
});

test('filtro vazio é vazio mesmo com espaço em branco', () => {
  assert.equal(estaVazio(FILTRO_VAZIO), true);
  assert.equal(estaVazio(normalizarFiltro({ nome: '   ' })), true);
  assert.equal(estaVazio(normalizarFiltro({ nome: 'alunos' })), false);
  assert.equal(estaVazio(normalizarFiltro({ tamanho: '10 MB' })), false);
});

test('o que veio do arquivo estragado vale como filtro vazio', () => {
  assert.deepEqual(normalizarFiltro(null), FILTRO_VAZIO);
  assert.deepEqual(normalizarFiltro('alunos'), FILTRO_VAZIO);
  assert.deepEqual(normalizarFiltro({ nome: 42, dono: ['x'] }), FILTRO_VAZIO);
});

test('a tela diz o que entendeu, como na spec 063', () => {
  const agora = new Date('2026-08-27T12:00:00Z');
  assert.equal(
    explicarFiltro(normalizarFiltro({ nome: 'alunos', tamanho: '10 MB' }), agora),
    'nome contém "alunos" · maior que 10 MB'
  );
  assert.equal(
    explicarFiltro(normalizarFiltro({ dono: 'ia_master', desde: '30d' }), agora),
    'dono é "ia_master" · mexida desde 2026-07-28'
  );
  // O que não deu para ler aparece como não lido, e não some calado.
  assert.equal(
    explicarFiltro(normalizarFiltro({ tamanho: 'grande' }), agora),
    'tamanho não entendido: "grande"'
  );
  assert.equal(explicarFiltro(FILTRO_VAZIO, agora), 'sem filtro');
});
