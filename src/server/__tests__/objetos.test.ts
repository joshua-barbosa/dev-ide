// As categorias da árvore do PostgreSQL (T110, spec 069).
//
// O teste existe por causa de UMA linha que é fácil de desfazer sem perceber:
// `views` lista só `relkind = 'v'`. Antes desta spec ela listava `'v'` e `'m'`
// no mesmo saco, e a contagem de views incluía view materializada.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORIAS, expandeEmColunas } from '../connections/drivers/postgres-objetos';

test('as sete categorias do PostgreSQL, na ordem', () => {
  assert.deepEqual(
    CATEGORIAS.map((c) => c.id),
    ['tables', 'views', 'matviews', 'foreign', 'functions', 'sequences', 'types']
  );
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
