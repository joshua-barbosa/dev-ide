// Os interruptores da árvore, por conexão.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  camposDeVisibilidade, categoriaVisivel, filtrarCategorias, nomeDoCampo, SECAO_DA_ARVORE,
} from '../sql/categorias-visiveis';

const OPCIONAIS = [
  { id: 'triggers', label: 'Triggers', padrao: false },
  { id: 'types', label: 'Types', padrao: true },
] as const;

test('categoria que não é opcional aparece sempre', () => {
  assert.equal(categoriaVisivel('tables', OPCIONAIS, {}), true);
  assert.equal(categoriaVisivel('tables', OPCIONAIS, { ver_tables: false }), true);
});

test('cadastro sem a escolha cai no padrão da categoria', () => {
  // O que já aparecia continua aparecendo: conexão antiga não perde categoria
  // só porque o interruptor nasceu hoje.
  assert.equal(categoriaVisivel('types', OPCIONAIS, {}), true);
  assert.equal(categoriaVisivel('triggers', OPCIONAIS, {}), false);
});

test('a escolha vence o padrão, nos dois sentidos', () => {
  assert.equal(categoriaVisivel('types', OPCIONAIS, { ver_types: false }), false);
  assert.equal(categoriaVisivel('triggers', OPCIONAIS, { ver_triggers: true }), true);
});

test('booleano que voltou como TEXTO conta igual', () => {
  // A ida e a volta pelo JSON do cadastro faz isso — é o mesmo motivo pelo qual
  // o `showIf` compara como texto.
  assert.equal(categoriaVisivel('triggers', OPCIONAIS, { ver_triggers: 'true' }), true);
  assert.equal(categoriaVisivel('types', OPCIONAIS, { ver_types: 'false' }), false);
});

test('texto vazio é "não respondido", e não "desligado"', () => {
  assert.equal(categoriaVisivel('types', OPCIONAIS, { ver_types: '' }), true);
});

test('os campos saem na mesma seção, com o padrão de cada um', () => {
  const campos = camposDeVisibilidade(OPCIONAIS);
  assert.deepEqual(campos.map((c) => c.name), ['ver_triggers', 'ver_types']);
  assert.deepEqual(campos.map((c) => c.default), [false, true]);
  assert.ok(campos.every((c) => c.section === SECAO_DA_ARVORE && c.type === 'boolean'));
  assert.equal(campos[0]?.label, 'Mostrar Triggers');
});

test('a ajuda só existe quando foi escrita', () => {
  const [sem, com] = camposDeVisibilidade([
    { id: 'a', label: 'A', padrao: true },
    { id: 'b', label: 'B', padrao: true, ajuda: 'por quê' },
  ]);
  assert.equal('help' in (sem ?? {}), false);
  assert.equal(com?.help, 'por quê');
});

test('peneirar preserva a ordem e devolve os mesmos objetos', () => {
  const cats = [{ id: 'tables' }, { id: 'triggers' }, { id: 'types' }];
  assert.deepEqual(
    filtrarCategorias(cats, OPCIONAIS, {}).map((c) => c.id),
    ['tables', 'types']
  );
  assert.deepEqual(
    filtrarCategorias(cats, OPCIONAIS, { ver_triggers: true, ver_types: false }).map((c) => c.id),
    ['tables', 'triggers']
  );
});

test('o nome do campo é derivado do id, e não digitado duas vezes', () => {
  assert.equal(nomeDoCampo('matviews'), 'ver_matviews');
});
