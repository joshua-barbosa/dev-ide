import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactar, indentar, modosDe, paraEditar, pareceJson, resumoDe,
} from '../grade/valor';

test('objeto e vetor são JSON; escalar solto NÃO é', () => {
  assert.equal(pareceJson('{"a":1}'), true);
  assert.equal(pareceJson('[1,2]'), true);
  // Pelo padrão os três abaixo são JSON válidos. Aqui não contam: oferecer o
  // modo JSON para a coluna `id` seria um botão inútil em toda linha.
  assert.equal(pareceJson('42'), false);
  assert.equal(pareceJson('"texto"'), false);
  assert.equal(pareceJson('null'), false);
});

test('JSON quebrado não é JSON', () => {
  assert.equal(pareceJson('{"a":1'), false);
  assert.equal(pareceJson('{a:1}'), false);
});

test('vazio e espaço em branco não são JSON', () => {
  assert.equal(pareceJson(''), false);
  assert.equal(pareceJson('   '), false);
});

test('espaço em volta não atrapalha', () => {
  assert.equal(pareceJson('  {"a":1}  '), true);
});

test('indentar quebra em linhas; compactar desfaz', () => {
  const bruto = '{"a":1,"b":[2,3]}';
  const bonito = indentar(bruto);
  assert.ok(bonito !== null);
  assert.ok(bonito.includes('\n'));
  assert.equal(compactar(bonito), bruto);
});

test('indentar devolve null no que não é JSON — e não o texto igual', () => {
  // Devolver o original faria o botão parecer quebrado em vez de ausente.
  assert.equal(indentar('PED6281'), null);
  assert.equal(compactar('PED6281'), null);
});

test('o modo JSON só existe quando há JSON', () => {
  assert.deepEqual(modosDe('{"a":1}'), ['texto', 'json']);
  assert.deepEqual(modosDe('PED6281'), ['texto']);
});

test('NULL do banco vira campo vazio, não a palavra NULL', () => {
  assert.equal(paraEditar(null), '');
  assert.equal(paraEditar(undefined), '');
  assert.equal(paraEditar(0), '0');
  assert.equal(paraEditar(''), '');
});

test('o resumo conta caracteres, e linhas só quando há mais de uma', () => {
  assert.equal(resumoDe('abc'), '3 caracteres');
  assert.equal(resumoDe('a'), '1 caractere');
  assert.ok(resumoDe('a\nb\nc').includes('3 linhas'));
});

test('o resumo de um JSON grande sai legível, com separador de milhar', () => {
  assert.ok(resumoDe('x'.repeat(4321)).startsWith('4.321 caracteres'));
});
