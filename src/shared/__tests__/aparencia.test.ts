import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alinhamentoDe, APARENCIA_PADRAO, ALTURA_MAXIMA, ALTURA_MINIMA, bordasDe, comAltura,
  ehTipoNumerico,
} from '../grade/aparencia';

test('o padrão é o que a grade já fazia antes desta fase', () => {
  // Mudar a tela de quem nunca abriu o olho seria trocá-la por decisão minha —
  // que é justamente o que esta spec desfaz.
  assert.equal(APARENCIA_PADRAO.numeroDaLinha, true);
  assert.equal(APARENCIA_PADRAO.colunaDeControle, true);
  assert.equal(APARENCIA_PADRAO.alinhamento, 'auto');
  assert.equal(APARENCIA_PADRAO.borda, 'todas');
});

test('a altura tem paredes dos dois lados', () => {
  assert.equal(comAltura(APARENCIA_PADRAO, 4).alturaDaLinha, ALTURA_MINIMA);
  assert.equal(comAltura(APARENCIA_PADRAO, 900).alturaDaLinha, ALTURA_MAXIMA);
});

test('comAltura devolve o MESMO objeto quando nada muda', () => {
  assert.equal(comAltura(APARENCIA_PADRAO, APARENCIA_PADRAO.alturaDaLinha), APARENCIA_PADRAO);
});

test('auto alinha número à direita e o resto à esquerda', () => {
  // É o que casa a vírgula decimal na vertical, e o que toda planilha faz.
  assert.equal(alinhamentoDe(APARENCIA_PADRAO, true), 'right');
  assert.equal(alinhamentoDe(APARENCIA_PADRAO, false), 'left');
});

test('escolha explícita vale para tudo, inclusive número', () => {
  const centro = { ...APARENCIA_PADRAO, alinhamento: 'centro' as const };
  assert.equal(alinhamentoDe(centro, true), 'center');
  assert.equal(alinhamentoDe(centro, false), 'center');
});

test('as quatro bordas viram as duas do CSS', () => {
  assert.deepEqual(bordasDe({ ...APARENCIA_PADRAO, borda: 'nenhuma' }), { direita: false, baixo: false });
  assert.deepEqual(bordasDe({ ...APARENCIA_PADRAO, borda: 'horizontal' }), { direita: false, baixo: true });
  assert.deepEqual(bordasDe({ ...APARENCIA_PADRAO, borda: 'vertical' }), { direita: true, baixo: false });
  assert.deepEqual(bordasDe({ ...APARENCIA_PADRAO, borda: 'todas' }), { direita: true, baixo: true });
});

test('reconhece número nos três dialetos, por prefixo', () => {
  for (const t of ['int', 'bigint unsigned', 'INT(11)', 'numeric(10,2)', 'double precision', 'int8', 'serial', 'REAL', 'money']) {
    assert.equal(ehTipoNumerico(t), true, t);
  }
});

test('e não confunde texto e data com número', () => {
  for (const t of ['varchar(255)', 'text', 'timestamp', 'date', 'json', 'blob', 'boolean', undefined]) {
    assert.equal(ehTipoNumerico(t), false, String(t));
  }
});
