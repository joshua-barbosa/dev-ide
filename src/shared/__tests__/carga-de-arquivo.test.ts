// O que atravessa entre a webview e o host é JSON — e JSON não tem bytes.
//
// Um `Uint8Array` posto num `postMessage` com `JSON.stringify` no meio vira
// `{"0":137,"1":80,...}`, que remontado do outro lado não é um PNG: é um
// objeto. O defeito seria silencioso — o arquivo salva, o tamanho até parece,
// e só ao abrir é que ele está corrompido. Por isso a carga é base64, e por
// isso ela tem teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daCarga, paraCarga, nomeDeArquivo } from '../arquivos/carga';

test('texto vai e volta igual, com acento', () => {
  const original = 'coordenação — ação, ímpar';
  assert.equal(new TextDecoder().decode(daCarga(paraCarga(original))), original);
});

test('bytes acima de 127 sobrevivem — é o caso do PNG e do zip', () => {
  const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 254]);
  assert.deepEqual(daCarga(paraCarga(original)), original);
});

test('vazio é vazio, e não erro', () => {
  assert.deepEqual(daCarga(paraCarga(new Uint8Array())), new Uint8Array());
  assert.equal(paraCarga(''), '');
});

test('a carga é uma STRING — se deixar de ser, o postMessage volta a corromper', () => {
  assert.equal(typeof paraCarga(new Uint8Array([1, 2, 3])), 'string');
});

test('nomeDeArquivo tira o caminho e deixa o nome', () => {
  assert.equal(nomeDeArquivo('/var/log/acme/relatorio.csv'), 'relatorio.csv');
  assert.equal(nomeDeArquivo('C:\\Users\\acme\\notas.json'), 'notas.json');
  assert.equal(nomeDeArquivo('sozinho.txt'), 'sozinho.txt');
});

test('nomeDeArquivo nunca devolve vazio', () => {
  // Barra no fim é o caso de baixar uma PASTA (o zip): o nome dela serve, e é
  // melhor que "arquivo". Sem nome nenhum é que entra o padrão.
  assert.equal(nomeDeArquivo('/uma/pasta/'), 'pasta');
  assert.equal(nomeDeArquivo(''), 'arquivo');
  assert.equal(nomeDeArquivo('/'), 'arquivo');
});

test('nomeDeArquivo recusa subir de pasta — o nome vem de fora', () => {
  // Um nome vindo do servidor remoto não pode virar caminho ao ser salvo.
  assert.equal(nomeDeArquivo('../../etc/passwd'), 'passwd');
  assert.equal(nomeDeArquivo('..'), 'arquivo');
});
