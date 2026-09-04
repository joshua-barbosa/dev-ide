import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valorLegivel } from '../chaves/valor-legivel';

test('JSON vira JSON com recuo, e os escapes viram letra', () => {
  const r = valorLegivel('{"materia":"Portugu\\u00eas","nivel":1}');
  assert.equal(r.ehJson, true);
  assert.equal(r.texto, '{\n  "materia": "Português",\n  "nivel": 1\n}');
});

test('texto que não é JSON volta intacto', () => {
  const r = valorLegivel('fila:2026-09-04 pronto');
  assert.equal(r.ehJson, false);
  assert.equal(r.texto, 'fila:2026-09-04 pronto');
});

test('JSON quebrado é dado, não erro: volta como veio', () => {
  const bruto = '{"a": 1,';
  const r = valorLegivel(bruto);
  assert.equal(r.ehJson, false);
  assert.equal(r.texto, bruto);
});

test('valor enorme não é reimpresso', () => {
  const bruto = `[${'"x",'.repeat(200_000)}"x"]`;
  assert.equal(valorLegivel(bruto).ehJson, false);
});
