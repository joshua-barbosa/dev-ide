import assert from 'node:assert/strict';
import test from 'node:test';
import { acharAlvos } from '../terminal/links';

const so = (linha: string) => acharAlvos(linha).map((a) => linha.slice(a.inicio, a.fim));

test('endereço vira link', () => {
  assert.deepEqual(so('subiu em http://localhost:3000 pronto'), ['http://localhost:3000']);
  assert.deepEqual(so('https://exemplo.com/a/b?c=1'), ['https://exemplo.com/a/b?c=1']);
});

test('o ponto final é da FRASE, e não do endereço', () => {
  assert.deepEqual(so('Veja em http://localhost:3000.'), ['http://localhost:3000']);
  assert.deepEqual(so('Abra http://x.com/a, depois volte'), ['http://x.com/a']);
});

test('caminho com linha vira alvo, com o número separado', () => {
  const [a] = acharAlvos('  File "src/app.py", line 42');
  // Aqui o formato é o do Python, sem `:` — fica para o T008, que é POR COMANDO.
  assert.equal(a, undefined);

  const [b] = acharAlvos('src/app.ts:42:7 - error TS2304');
  assert.equal(b?.caminho, 'src/app.ts');
  assert.equal(b?.linha, 42);
  assert.equal(b?.coluna, 7);
});

test('sem coluna também vale — é o formato do `grep -n`', () => {
  const [a] = acharAlvos('src/main.ts:10: const x = 1');
  assert.equal(a?.caminho, 'src/main.ts');
  assert.equal(a?.linha, 10);
  assert.equal(a?.coluna, undefined);
});

test('caminho relativo e absoluto', () => {
  assert.equal(acharAlvos('./src/a.ts:1')[0]?.caminho, './src/a.ts');
  assert.equal(acharAlvos('/home/x/a.ts:1')[0]?.caminho, '/home/x/a.ts');
  assert.equal(acharAlvos('../b/c.ts:9')[0]?.caminho, '../b/c.ts');
});

test('palavra com dois-pontos NÃO vira link', () => {
  // Sem exigir barra, `erro:12` numa frase comum viraria link para um arquivo
  // chamado "erro" — e um link que não abre nada é pior que texto.
  assert.deepEqual(acharAlvos('erro:12 aconteceu'), []);
  assert.deepEqual(acharAlvos('total:42'), []);
});

test('hora não vira link', () => {
  assert.deepEqual(acharAlvos('terminou às 14:32:10'), []);
});

test('o caminho dentro de uma URL não é marcado duas vezes', () => {
  const alvos = acharAlvos('veja http://x.com/src/a.ts:3 agora');
  assert.equal(alvos.length, 1);
  assert.equal(alvos[0]?.tipo, 'url');
});

test('dois alvos na mesma linha saem em ORDEM', () => {
  const alvos = acharAlvos('src/a.ts:1 e http://x.com');
  assert.deepEqual(alvos.map((a) => a.tipo), ['arquivo', 'url']);
});

test('linha sem nada devolve lista vazia', () => {
  assert.deepEqual(acharAlvos('apenas texto comum'), []);
  assert.deepEqual(acharAlvos(''), []);
});
