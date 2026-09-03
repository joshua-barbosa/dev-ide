// As categorias da árvore do PostgreSQL (T110, spec 069).
//
// O teste existe por causa de UMA linha que é fácil de desfazer sem perceber:
// `views` lista só `relkind = 'v'`. Antes desta spec ela listava `'v'` e `'m'`
// no mesmo saco, e a contagem de views incluía view materializada.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORIAS, OPCIONAIS, expandeEmColunas } from '../connections/drivers/postgres-objetos';

test('as nove categorias do PostgreSQL, na ordem', () => {
  // `procedures` nasceu em 03/09/2026: `prokind = 'f'` deixava PROCEDURE de
  // fora, e ele viu a falta. `triggers` nasceu no mesmo dia, a pedido dele.
  assert.deepEqual(
    CATEGORIAS.map((c) => c.id),
    [
      'tables', 'views', 'matviews', 'foreign',
      'functions', 'procedures', 'sequences', 'types', 'triggers',
    ]
  );
});

test('as opcionais são um subconjunto das categorias, e as essenciais não entram', () => {
  const ids = new Set(CATEGORIAS.map((c) => c.id));
  assert.ok(OPCIONAIS.every((o) => ids.has(o.id)), 'interruptor sem categoria não liga nada');
  for (const essencial of ['tables', 'views', 'functions', 'procedures']) {
    assert.equal(
      OPCIONAIS.some((o) => o.id === essencial), false,
      `${essencial} não pode ser desligável: a árvore ficaria vazia`
    );
  }
});

test('toda opcional do PostgreSQL nasce LIGADA', () => {
  // Interruptor novo não pode apagar da tela o que ele via ontem.
  assert.ok(OPCIONAIS.every((o) => o.padrao === true));
});

test('view materializada NÃO é view', () => {
  const views = CATEGORIAS.find((c) => c.id === 'views');
  const matviews = CATEGORIAS.find((c) => c.id === 'matviews');
  assert.deepEqual(views?.kinds, ['v']);
  assert.deepEqual(matviews?.kinds, ['m']);
});

test('só expande em colunas o que TEM coluna', () => {
  assert.equal(expandeEmColunas('tables'), true);
  assert.equal(expandeEmColunas('views'), true);
  assert.equal(expandeEmColunas('matviews'), true);
  assert.equal(expandeEmColunas('foreign'), true);
  assert.equal(expandeEmColunas('functions'), false);
  assert.equal(expandeEmColunas('sequences'), false);
  assert.equal(expandeEmColunas('types'), false);
  assert.equal(expandeEmColunas(undefined), false);
});

test('a matview não oferece DROP VIEW, que o banco recusaria', () => {
  const acoes = CATEGORIAS.find((c) => c.id === 'matviews')?.acoes ?? [];
  assert.equal(acoes.some((a) => a.id === 'drop-view'), false);
  assert.equal(acoes.some((a) => a.id === 'drop-matview'), true);
  assert.equal(acoes.some((a) => a.id === 'refresh-matview'), true);
});
