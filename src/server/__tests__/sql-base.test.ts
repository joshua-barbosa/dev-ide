import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_CELL_CHARS,
  MAX_ROW_LIMIT,
  applyVisibility,
  formatCell,
  isVisible,
  mainFirst,
  parseNameList,
  quoteIdentifier,
  resolveRowLimit,
  resolveTimeout,
} from '../connections/drivers/sql-base';

// ---- quoting de identificadores ----

test('cita identificadores no estilo de cada banco', () => {
  assert.equal(quoteIdentifier('users', 'backtick'), '`users`');
  assert.equal(quoteIdentifier('users', 'double'), '"users"');
});

test('escapa a própria aspa dobrando — bloqueia injeção via nome de objeto', () => {
  assert.equal(quoteIdentifier('we`ird', 'backtick'), '`we``ird`');
  assert.equal(quoteIdentifier('we"ird', 'double'), '"we""ird"');
  assert.equal(quoteIdentifier('a`; DROP TABLE x; --', 'backtick'), '`a``; DROP TABLE x; --`');
});

test('recusa identificador com byte nulo ou vazio', () => {
  assert.throws(() => quoteIdentifier('a\0b', 'backtick'), /inválido/i);
  assert.throws(() => quoteIdentifier('', 'double'), /inválido/i);
});

// ---- normalização de célula ----

test('preserva os tipos que o grid entende direto', () => {
  assert.equal(formatCell(null), null);
  assert.equal(formatCell(undefined), null);
  assert.equal(formatCell('texto'), 'texto');
  assert.equal(formatCell(42), 42);
  assert.equal(formatCell(true), true);
});

test('converte tipos que não sobrevivem ao JSON', () => {
  assert.equal(formatCell(10n), '10');
  assert.equal(formatCell(new Date('2026-08-13T12:00:00.000Z')), '2026-08-13T12:00:00.000Z');
  assert.equal(formatCell(Buffer.from([0xde, 0xad])), '0xdead');
  assert.equal(formatCell({ a: 1 }), '{"a":1}');
  assert.equal(formatCell([1, 2]), '[1,2]');
});

test('trunca célula gigante para não estourar o grid', () => {
  const gigante = 'x'.repeat(MAX_CELL_CHARS + 500);
  const saida = formatCell(gigante) as string;
  assert.equal(saida.length, MAX_CELL_CHARS + 1);
  assert.ok(saida.endsWith('…'));
});

test('trunca BLOB gigante também', () => {
  const saida = formatCell(Buffer.alloc(MAX_CELL_CHARS, 0xab)) as string;
  assert.ok(saida.length <= MAX_CELL_CHARS + 1);
  assert.ok(saida.startsWith('0x'));
});

// ---- limites ----

test('limite de linhas cai no padrão e respeita o teto', () => {
  assert.equal(resolveRowLimit(undefined), 500);
  assert.equal(resolveRowLimit(50), 50);
  assert.equal(resolveRowLimit(MAX_ROW_LIMIT + 1000), MAX_ROW_LIMIT);
  assert.equal(resolveRowLimit(0), 1);
  assert.equal(resolveRowLimit(-5), 1);
  assert.equal(resolveRowLimit(3.7), 3);
});

test('timeout cai no padrão e respeita o teto', () => {
  assert.equal(resolveTimeout(undefined), 30_000);
  assert.equal(resolveTimeout(5_000), 5_000);
  assert.equal(resolveTimeout(10 * 60_000), 120_000);
  assert.equal(resolveTimeout(0), 1_000);
});

// ---- bancos visíveis / banco principal ----

test('aceita lista separada por vírgula, quebra de linha ou ponto e vírgula', () => {
  assert.deepEqual(parseNameList('servidor-2, servidor-1'), ['servidor-2', 'servidor-1']);
  assert.deepEqual(parseNameList('servidor-2\nservidor-1'), ['servidor-2', 'servidor-1']);
  assert.deepEqual(parseNameList('servidor-2;servidor-1'), ['servidor-2', 'servidor-1']);
  assert.deepEqual(parseNameList('  servidor-2 ,, \n servidor-1  '), ['servidor-2', 'servidor-1']);
});

test('lista vazia significa "sem filtro"', () => {
  assert.deepEqual(parseNameList(''), []);
  assert.deepEqual(parseNameList('   '), []);
  assert.deepEqual(parseNameList(undefined), []);
  assert.deepEqual(parseNameList(',,;'), []);
});

test('sem filtro, tudo é visível', () => {
  assert.equal(isVisible('information_schema', []), true);
  assert.equal(isVisible('servidor-2', []), true);
});

test('com filtro, só o que está na lista aparece', () => {
  const lista = ['servidor-2', 'servidor-1'];
  assert.equal(isVisible('servidor-2', lista), true);
  assert.equal(isVisible('information_schema', lista), false);
});

test('o filtro ignora diferença de maiúsculas', () => {
  assert.equal(isVisible('Servidor-2', ['servidor-2']), true);
  assert.equal(isVisible('servidor-2', ['SERVIDOR-2']), true);
});

test('o banco principal vai para o topo, o resto mantém a ordem', () => {
  const nomes = ['alpha', 'servidor-2', 'zulu'];
  assert.deepEqual(mainFirst(nomes, 'servidor-2', (n) => n), ['servidor-2', 'alpha', 'zulu']);
});

test('sem banco principal, ou com um que não existe, a ordem não muda', () => {
  const nomes = ['alpha', 'servidor-2'];
  assert.deepEqual(mainFirst(nomes, '', (n) => n), nomes);
  assert.deepEqual(mainFirst(nomes, 'inexistente', (n) => n), nomes);
});

test('mainFirst não muta o array recebido', () => {
  const nomes = ['alpha', 'servidor-2'];
  mainFirst(nomes, 'servidor-2', (n) => n);
  assert.deepEqual(nomes, ['alpha', 'servidor-2']);
});

// ---- visibilidade combinada ----

const SISTEMA = ['information_schema', 'performance_schema', 'mysql', 'sys'];
const TODOS = ['servidor-2', 'servidor-1', 'information_schema', 'performance_schema', 'mysql', 'sys', 'teste_tmp'];
const id = (n: string) => n;

function visibilidade(over: Partial<Parameters<typeof applyVisibility>[2]> = {}) {
  return { show: [], excludePattern: '', hideSystem: true, systemNames: SISTEMA, ...over };
}

test('esconde schemas de sistema por padrão', () => {
  assert.deepEqual(applyVisibility(TODOS, id, visibilidade()), ['servidor-2', 'servidor-1', 'teste_tmp']);
});

test('mostra schemas de sistema quando desligado', () => {
  assert.deepEqual(applyVisibility(TODOS, id, visibilidade({ hideSystem: false })), TODOS);
});

test('exclui por regex', () => {
  assert.deepEqual(
    applyVisibility(TODOS, id, visibilidade({ excludePattern: '_tmp$' })),
    ['servidor-2', 'servidor-1']
  );
});

test('regex inválida é ignorada em vez de derrubar a navegação', () => {
  assert.deepEqual(
    applyVisibility(TODOS, id, visibilidade({ excludePattern: '[a-' })),
    ['servidor-2', 'servidor-1', 'teste_tmp']
  );
});

test('lista branca vence, e combina com as demais regras', () => {
  assert.deepEqual(
    applyVisibility(TODOS, id, visibilidade({ show: ['servidor-2', 'mysql'] })),
    ['servidor-2'],
    'mysql está na lista branca mas é de sistema — continua escondido'
  );
  assert.deepEqual(
    applyVisibility(TODOS, id, visibilidade({ show: ['servidor-2', 'mysql'], hideSystem: false })),
    ['servidor-2', 'mysql']
  );
});
