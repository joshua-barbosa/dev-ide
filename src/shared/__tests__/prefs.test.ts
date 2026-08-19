import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVES, ESQUEMA, mesclar, normalizar, padroes, validarPatch,
} from '../prefs';

test('os padrões cobrem todas as chaves declaradas', () => {
  const p = padroes() as Record<string, unknown>;
  for (const chave of CHAVES) assert.equal(p[chave], ESQUEMA[chave].padrao);
  assert.equal(Object.keys(p).length, CHAVES.length);
});

test('padroes() devolve objeto novo a cada chamada', () => {
  const a = padroes() as Record<string, unknown>;
  a['editor.fontSize'] = 99;
  assert.equal(padroes()['editor.fontSize'], ESQUEMA['editor.fontSize'].padrao);
});

// ---- fronteira tolerante: o arquivo -----------------------------------------

test('arquivo ausente ou lixo vira os padrões, sem lançar', () => {
  for (const entrada of [undefined, null, 42, 'texto', [], [1, 2]]) {
    assert.deepEqual(normalizar(entrada), padroes());
  }
});

test('valor de tipo errado cai no padrão e não derruba as outras chaves', () => {
  const p = normalizar({ 'editor.fontSize': 'grande', 'editor.tabSize': 2 });
  assert.equal(p['editor.fontSize'], 13);
  assert.equal(p['editor.tabSize'], 2);
});

test('valor fora da faixa cai no padrão', () => {
  assert.equal(normalizar({ 'editor.fontSize': 0 })['editor.fontSize'], 13);
  assert.equal(normalizar({ 'editor.fontSize': 999 })['editor.fontSize'], 13);
  assert.equal(normalizar({ 'editor.fontSize': 12.5 })['editor.fontSize'], 13);
});

test('os extremos da faixa são aceitos', () => {
  assert.equal(normalizar({ 'editor.fontSize': 8 })['editor.fontSize'], 8);
  assert.equal(normalizar({ 'editor.fontSize': 40 })['editor.fontSize'], 40);
});

test('chave desconhecida no arquivo é ignorada, não fatal', () => {
  const p = normalizar({ 'editor.fontSize': 20, 'algo.do.futuro': 'x' });
  assert.equal(p['editor.fontSize'], 20);
  assert.equal((p as Record<string, unknown>)['algo.do.futuro'], undefined);
});

test('booleano só aceita booleano — "true" em texto não conta', () => {
  assert.equal(normalizar({ 'editor.wordWrap': 'true' })['editor.wordWrap'], false);
  assert.equal(normalizar({ 'editor.wordWrap': 1 })['editor.wordWrap'], false);
  assert.equal(normalizar({ 'editor.wordWrap': true })['editor.wordWrap'], true);
});

// ---- fronteira rígida: a rota ------------------------------------------------

test('patch com chave desconhecida é recusado, ao contrário do arquivo', () => {
  assert.throws(() => validarPatch({ 'algo.do.futuro': 1 }), /desconhecida.*algo\.do\.futuro/);
});

test('patch com valor inválido diz a chave e o que se esperava', () => {
  assert.throws(
    () => validarPatch({ 'editor.fontSize': 999 }),
    /editor\.fontSize.*inteiro entre 8 e 40/
  );
  assert.throws(() => validarPatch({ 'editor.wordWrap': 'sim' }), /wordWrap.*true ou false/);
});

test('patch que não é objeto é recusado', () => {
  for (const entrada of [null, 42, 'x', []]) {
    assert.throws(() => validarPatch(entrada), /objeto de preferências/);
  }
});

test('patch válido devolve só o que veio', () => {
  assert.deepEqual(validarPatch({ 'editor.tabSize': 2 }), { 'editor.tabSize': 2 });
  assert.deepEqual(validarPatch({}), {});
});

// ---- mesclagem ---------------------------------------------------------------

test('mesclar preserva o que o patch não menciona e não muta a origem', () => {
  const atual = padroes();
  const novo = mesclar(atual, { 'editor.fontSize': 18 });
  assert.equal(novo['editor.fontSize'], 18);
  assert.equal(novo['editor.tabSize'], atual['editor.tabSize']);
  assert.equal(atual['editor.fontSize'], 13, 'a origem não pode ser mutada');
});

// ---- opções (spec 015) --------------------------------------------------------

test('preferência de opção só aceita um dos valores declarados', () => {
  assert.equal(normalizar({ 'editor.autoSave': 'afterDelay' })['editor.autoSave'], 'afterDelay');
  assert.equal(normalizar({ 'editor.autoSave': 'onFocusChange' })['editor.autoSave'], 'onFocusChange');
  // Valor inventado cai no padrão em vez de virar um modo que ninguém trata.
  assert.equal(normalizar({ 'editor.autoSave': 'sempre' })['editor.autoSave'], 'off');
  assert.equal(normalizar({ 'editor.autoSave': true })['editor.autoSave'], 'off');
});

test('o patch recusa opção fora da lista, dizendo quais valem', () => {
  assert.throws(
    () => validarPatch({ 'editor.autoSave': 'sempre' }),
    /editor\.autoSave.*off, afterDelay, onFocusChange/
  );
});

test('o atraso do auto save tem faixa', () => {
  assert.equal(normalizar({ 'editor.autoSaveDelay': 50 })['editor.autoSaveDelay'], 1_000);
  assert.equal(normalizar({ 'editor.autoSaveDelay': 300 })['editor.autoSaveDelay'], 300);
});
