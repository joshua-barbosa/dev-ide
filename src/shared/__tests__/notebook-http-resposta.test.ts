// A resposta da célula HTTP na tela (spec 120, etapa 1): as contas puras.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatarCorpo, linguagemDoCorpo, nomeParaSalvar, tamanhoLegivel } from '../notebook/http-resposta';

test('JSON é indentado com 2 espaços', () => {
  assert.equal(formatarCorpo('{"a":1,"b":[1,2]}', 'application/json'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
});

test('JSON quebrado volta como chegou', () => {
  assert.equal(formatarCorpo('{"a":', 'application/json'), '{"a":');
});

test('XML é indentado, uma tag por linha; texto curto fica junto da tag', () => {
  assert.equal(
    formatarCorpo('<?xml version="1.0"?><a><b x="1">oi</b><c/></a>', 'application/xml'),
    '<?xml version="1.0"?>\n<a>\n  <b x="1">oi</b>\n  <c/>\n</a>'
  );
});

test('texto comum não é mexido', () => {
  assert.equal(formatarCorpo('  oi\n', 'text/plain'), '  oi\n');
});

test('linguagem do realce pelo Content-Type', () => {
  assert.equal(linguagemDoCorpo('application/json; charset=utf-8'), 'json');
  assert.equal(linguagemDoCorpo('application/problem+json'), 'json');
  assert.equal(linguagemDoCorpo('text/xml'), 'xml');
  assert.equal(linguagemDoCorpo('text/html'), 'html');
  assert.equal(linguagemDoCorpo('text/plain'), 'plain');
});

test('tamanho legível', () => {
  assert.equal(tamanhoLegivel(512), '512 B');
  assert.equal(tamanhoLegivel(1536), '1,5 KB');
  assert.equal(tamanhoLegivel(2 * 1024 * 1024), '2 MB');
});

test('nome para salvar: o fim da URL; sem ele, resposta + extensão do tipo', () => {
  assert.equal(nomeParaSalvar('http://h/arquivos/foto.png?x=1', 'image/png'), 'foto.png');
  assert.equal(nomeParaSalvar('http://h/api/', 'application/json'), 'resposta.json');
  assert.equal(nomeParaSalvar('http://h/relatorio', 'application/pdf'), 'relatorio.pdf');
  assert.equal(nomeParaSalvar('', 'application/octet-stream'), 'resposta.bin');
});
