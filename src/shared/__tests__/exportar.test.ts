import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campoCsv, paraCsv, paraJson } from '../exportar';

const COLUNAS = [{ name: 'id' }, { name: 'nome' }];

test('campo simples não ganha aspas', () => {
  assert.equal(campoCsv('joshua', ','), 'joshua');
});

test('campo com o separador dentro vai entre aspas', () => {
  assert.equal(campoCsv('a,b', ','), '"a,b"');
  // E com `;` como separador, a vírgula deixa de ser especial.
  assert.equal(campoCsv('a,b', ';'), 'a,b');
});

test('aspa interna é dobrada', () => {
  assert.equal(campoCsv('diz "oi"', ','), '"diz ""oi"""');
});

test('quebra de linha força as aspas', () => {
  assert.equal(campoCsv('a\nb', ','), '"a\nb"');
  assert.equal(campoCsv('a\rb', ','), '"a\rb"');
});

test('NULL vira campo vazio, e não a palavra null', () => {
  // Senão não haveria como distinguir de uma célula com o texto "null".
  assert.equal(campoCsv(null, ','), '');
  assert.equal(campoCsv('null', ','), 'null');
});

test('número e booleano saem como texto, sem aspas', () => {
  assert.equal(campoCsv(42, ','), '42');
  assert.equal(campoCsv(false, ','), 'false');
});

test('o CSV leva o cabeçalho e termina cada linha com CRLF', () => {
  const csv = paraCsv(COLUNAS, [[1, 'joshua'], [2, 'a,b']]);
  assert.equal(csv, 'id,nome\r\n1,joshua\r\n2,"a,b"\r\n');
});

test('o CSV aceita ponto-e-vírgula, que é o que o Excel em português espera', () => {
  assert.equal(paraCsv(COLUNAS, [[1, 'a,b']], { separador: ';' }), 'id;nome\r\n1;a,b\r\n');
});

test('sem linhas, o CSV ainda traz o cabeçalho', () => {
  assert.equal(paraCsv(COLUNAS, []), 'id,nome\r\n');
});

test('o JSON sai como lista de objetos, com null preservado', () => {
  const json = JSON.parse(paraJson(COLUNAS, [[1, null]])) as unknown[];
  assert.deepEqual(json, [{ id: 1, nome: null }]);
});

test('coluna a mais que a linha vira null, e não undefined', () => {
  // `undefined` some do JSON.stringify, e a chave sumiria do objeto.
  const json = JSON.parse(paraJson([...COLUNAS, { name: 'extra' }], [[1, 'x']])) as Record<
    string, unknown
  >[];
  assert.equal('extra' in (json[0] ?? {}), true);
  assert.equal(json[0]?.extra, null);
});
