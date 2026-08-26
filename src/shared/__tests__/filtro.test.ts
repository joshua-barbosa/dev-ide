import assert from 'node:assert/strict';
import test from 'node:test';
import { explicarFiltro, interpretarFiltro } from '../grade/filtro';

test('texto sem sinal continua sendo `contém` — o dedo de quem já usa não quebra', () => {
  assert.deepEqual(interpretarFiltro('joshua'), { operador: 'contem', valores: ['joshua'] });
});

test('vazio e só espaço não filtram nada', () => {
  assert.equal(interpretarFiltro(''), null);
  assert.equal(interpretarFiltro('   '), null);
});

test('`>=` é lido antes de `>` — senão `>=10` viraria maior que "=10"', () => {
  assert.deepEqual(interpretarFiltro('>=10'), { operador: 'maiorOuIgual', valores: ['10'] });
  assert.deepEqual(interpretarFiltro('<=10'), { operador: 'menorOuIgual', valores: ['10'] });
  assert.deepEqual(interpretarFiltro('>10'), { operador: 'maior', valores: ['10'] });
  assert.deepEqual(interpretarFiltro('<10'), { operador: 'menor', valores: ['10'] });
});

test('as duas formas de "diferente" que o SQL aceita', () => {
  assert.deepEqual(interpretarFiltro('!=x'), { operador: 'diferente', valores: ['x'] });
  assert.deepEqual(interpretarFiltro('<>x'), { operador: 'diferente', valores: ['x'] });
});

test('nulo em português e em SQL, e a negação dele', () => {
  for (const t of ['null', 'NULL', 'nulo', ' Nulo ']) {
    assert.deepEqual(interpretarFiltro(t), { operador: 'nulo', valores: [] }, t);
  }
  assert.deepEqual(interpretarFiltro('!null'), { operador: 'naoNulo', valores: [] });
  assert.deepEqual(interpretarFiltro('!nulo'), { operador: 'naoNulo', valores: [] });
});

test('intervalo fechado dos dois lados, com número e com data', () => {
  assert.deepEqual(interpretarFiltro('1..5'), { operador: 'entre', valores: ['1', '5'] });
  assert.deepEqual(interpretarFiltro('2024-01-01..2024-12-31'), {
    operador: 'entre',
    valores: ['2024-01-01', '2024-12-31'],
  });
});

test('`=` é o escape para quem procura o TEXTO literal', () => {
  // Sem isto não haveria como procurar a palavra "null" numa coluna de texto.
  assert.deepEqual(interpretarFiltro('=null'), { operador: 'igual', valores: ['null'] });
  assert.deepEqual(interpretarFiltro('=1..5'), { operador: 'igual', valores: ['1..5'] });
});

test('operador sem valor não filtra: `>` sozinho é meio caminho', () => {
  // Tratar como string vazia devolveria a tabela inteira sem o usuário
  // entender por quê.
  assert.equal(interpretarFiltro('>'), null);
  assert.equal(interpretarFiltro('>=  '), null);
});

test('intervalo pela metade cai em `contém`, e não em `entre` quebrado', () => {
  assert.deepEqual(interpretarFiltro('1..'), { operador: 'contem', valores: ['1..'] });
  assert.deepEqual(interpretarFiltro('..5'), { operador: 'contem', valores: ['..5'] });
});

test('três pontos não é intervalo de três pedaços', () => {
  assert.deepEqual(interpretarFiltro('1..2..3'), { operador: 'contem', valores: ['1..2..3'] });
});

test('a explicação some no padrão e aparece no resto', () => {
  assert.equal(explicarFiltro('joshua'), null);
  assert.equal(explicarFiltro('>10'), 'maior que 10');
  assert.equal(explicarFiltro('null'), 'é nulo');
  assert.equal(explicarFiltro('1..5'), 'entre 1 e 5');
});
