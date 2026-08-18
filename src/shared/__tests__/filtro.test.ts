import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detalheDaCategoria, padraoDeFiltro, temFiltro } from '../tree/filtro';

// ---- tradução do padrão (AC-5, AC-6) ----

test('sem curinga, o padrão vira "contém"', () => {
  // Digitar um pedaço do nome é o uso comum; exigir % seria hostil.
  assert.equal(padraoDeFiltro('alunos'), '%alunos%');
});

test('com curinga, o padrão é respeitado como escrito', () => {
  assert.equal(padraoDeFiltro('tiraduvidas_%'), 'tiraduvidas_%');
  assert.equal(padraoDeFiltro('%_alunos'), '%_alunos');
  assert.equal(padraoDeFiltro('gr%cos'), 'gr%cos');
});

test('o sublinhado sozinho já conta como curinga', () => {
  // `_` casa um caractere no LIKE; envolvê-lo em % mudaria o que foi pedido.
  assert.equal(padraoDeFiltro('alun_s'), 'alun_s');
});

test('espaços em volta não contam', () => {
  assert.equal(padraoDeFiltro('  alunos  '), '%alunos%');
});

test('vazio significa ausência de filtro', () => {
  assert.equal(padraoDeFiltro(''), null);
  assert.equal(padraoDeFiltro('   '), null);
});

test('o padrão hostil sai como texto, e não vira sintaxe', () => {
  // Sair intacto é o certo: quem impede o estrago é a LIGAÇÃO como parâmetro,
  // não uma limpeza aqui — limpar daria falsa sensação e quebraria nomes
  // legítimos.
  assert.equal(padraoDeFiltro("'; DROP TABLE alunos; --"), "%'; DROP TABLE alunos; --%");
});

// ---- sinal de filtro ativo (AC-8) ----

test('reconhece quando há filtro em vigor', () => {
  assert.equal(temFiltro('alunos'), true);
  assert.equal(temFiltro(''), false);
  assert.equal(temFiltro('  '), false);
  assert.equal(temFiltro(null), false);
  assert.equal(temFiltro(undefined), false);
});

test('o detalhe mostra achado e total quando filtrado', () => {
  assert.equal(detalheDaCategoria(12, 92), '12 de 92');
});

test('sem filtro, mostra só a contagem', () => {
  assert.equal(detalheDaCategoria(92, null), '92');
  assert.equal(detalheDaCategoria(92, 92), '92');
});

test('filtro que não acha nada mostra zero de total', () => {
  assert.equal(detalheDaCategoria(0, 92), '0 de 92');
});
