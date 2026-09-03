// As categorias da árvore do SQL Server.
//
// Testa o SQL como TEXTO, e não contra servidor: o que se quer garantir é que
// o nome do banco vá entre colchetes e que cada categoria leia da view certa
// do catálogo — as duas coisas que quebram calado.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIAS, OPCIONAIS, colunasSql, contagensSql, expandeEmColunas,
  nosDeCategoria, objetosSql,
} from '../connections/drivers/sqlserver-objetos';

test('as sete categorias, na ordem', () => {
  assert.deepEqual(
    CATEGORIAS.map((c) => c.id),
    ['tables', 'views', 'functions', 'procedures', 'triggers', 'sequences', 'types']
  );
});

test('só tabela e view expandem em colunas', () => {
  assert.equal(expandeEmColunas('tables'), true);
  assert.equal(expandeEmColunas('views'), true);
  assert.equal(expandeEmColunas('procedures'), false);
  assert.equal(expandeEmColunas('triggers'), false);
  assert.equal(expandeEmColunas(undefined), false);
});

test('as opcionais são as três que o SQL Server realmente tem', () => {
  // Foreign table e materialized view NÃO entram: external table do PolyBase e
  // indexed view são outra coisa, e nomeá-las assim faria a árvore mentir.
  assert.deepEqual(OPCIONAIS.map((o) => o.id), ['triggers', 'sequences', 'types']);
  assert.ok(OPCIONAIS.every((o) => o.padrao === true));
});

test('o nome do banco vai entre COLCHETES, e o colchete de dentro é dobrado', () => {
  const sql = contagensSql('meu]banco');
  assert.ok(sql.includes('[meu]]banco].sys.tables'), sql);
});

test('a contagem pergunta por todas as categorias de uma vez', () => {
  const sql = contagensSql('loja');
  for (const c of CATEGORIAS) assert.ok(sql.includes(`AS [${c.id}]`), `faltou ${c.id}`);
  assert.equal(sql.split('SELECT').length - 1, 1 + CATEGORIAS.length, 'um SELECT por categoria');
});

test('função filtra as TRÊS espécies, e tipo filtra o que o usuário criou', () => {
  const funcoes = CATEGORIAS.find((c) => c.id === 'functions');
  assert.equal(funcoes?.onde, "type IN ('FN', 'IF', 'TF')");
  assert.equal(CATEGORIAS.find((c) => c.id === 'types')?.onde, 'is_user_defined = 1');
});

test('gatilho sai com a TABELA de quem pende, e não com o schema', () => {
  const sql = objetosSql('loja', CATEGORIAS.find((c) => c.id === 'triggers')!);
  assert.ok(sql.includes('sys.triggers'), sql);
  assert.ok(sql.includes('sys.tables t ON t.object_id = tg.parent_id'), sql);
  assert.ok(!sql.includes('sys.schemas'), 'gatilho não pende de schema');
});

test('a coluna filtra pela tabela, com a aspa do nome escapada', () => {
  const sql = colunasSql('loja', "s'chema", "ta'bela");
  assert.ok(sql.includes("TABLE_SCHEMA = 's''chema'"), sql);
  assert.ok(sql.includes("TABLE_NAME = 'ta''bela'"), sql);
});

test('o interruptor do cadastro tira a categoria da árvore', () => {
  const contagens = { tables: 3, views: 1, triggers: 9, sequences: 2, types: 4 };
  const todas = nosDeCategoria('loja', contagens, {});
  assert.deepEqual(
    todas.map((n) => n.id),
    ['tables', 'views', 'functions', 'procedures', 'triggers', 'sequences', 'types']
  );
  const menos = nosDeCategoria('loja', contagens, { ver_triggers: false, ver_types: false });
  assert.deepEqual(menos.map((n) => n.id), ['tables', 'views', 'functions', 'procedures', 'sequences']);
});

test('contagem que o servidor não soube dizer não vira zero', () => {
  // Zero é uma afirmação; ausência não é. Mostrar "0" onde não se sabe faria
  // procurar objeto que talvez exista.
  const [tabelas] = nosDeCategoria('loja', { tables: null }, {});
  assert.equal(tabelas?.detail, undefined);
  const [comNumero] = nosDeCategoria('loja', { tables: 7 }, {});
  assert.equal(comNumero?.detail, '7');
});
