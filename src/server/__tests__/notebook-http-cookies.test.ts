// O pote de cookies de um notebook (spec 120, etapa 3): o que uma célula
// recebe, as próximas mandam — para o mesmo host, como um navegador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PoteDeCookies } from '../notebook/cookies-http';

const AGORA = Date.UTC(2026, 9, 28, 12);
const u = (t: string) => new URL(t);

test('cookie sem Domain: só o MESMO host recebe', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://api.exemplo.test/login'), ['sessao=abc; Path=/; HttpOnly'], AGORA);
  assert.equal(pote.cabecalho(u('http://api.exemplo.test/eu'), AGORA), 'sessao=abc');
  assert.equal(pote.cabecalho(u('http://outro.exemplo.test/eu'), AGORA), null);
  assert.equal(pote.cabecalho(u('http://sub.api.exemplo.test/eu'), AGORA), null);
});

test('Domain=exemplo.test: os subdomínios também recebem', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://login.exemplo.test/'), ['t=1; Domain=.exemplo.test'], AGORA);
  assert.equal(pote.cabecalho(u('http://api.exemplo.test/'), AGORA), 't=1');
  assert.equal(pote.cabecalho(u('http://exemplo.test/'), AGORA), 't=1');
  assert.equal(pote.cabecalho(u('http://outroexemplo.test/'), AGORA), null);
});

test('Domain de outro site é recusado (um servidor não põe cookie para outro)', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://mal.exemplo.test/'), ['x=1; Domain=banco.test'], AGORA);
  assert.equal(pote.lista(AGORA).length, 0);
});

test('Path: /api recebe em /api/x, não em /outro; sem Path, o diretório da URL', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/qualquer'), ['a=1; Path=/api'], AGORA);
  pote.guardar(u('http://h/conta/login'), ['b=2'], AGORA);
  assert.equal(pote.cabecalho(u('http://h/api/x'), AGORA), 'a=1');
  assert.equal(pote.cabecalho(u('http://h/apiruim'), AGORA), null);
  assert.equal(pote.cabecalho(u('http://h/conta/eu'), AGORA), 'b=2');
});

test('Secure só vai por https', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('https://h/'), ['s=1; Secure'], AGORA);
  assert.equal(pote.cabecalho(u('http://h/'), AGORA), null);
  assert.equal(pote.cabecalho(u('https://h/'), AGORA), 's=1');
});

test('expira: Max-Age, Expires, e Max-Age=0 apaga', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/'), ['a=1; Max-Age=60', 'b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT', 'c=3'], AGORA);
  assert.equal(pote.cabecalho(u('http://h/'), AGORA), 'a=1; c=3');
  assert.equal(pote.cabecalho(u('http://h/'), AGORA + 61_000), 'c=3');
  pote.guardar(u('http://h/'), ['c=; Max-Age=0'], AGORA + 62_000);
  assert.equal(pote.cabecalho(u('http://h/'), AGORA + 62_000), null);
});

test('o mesmo nome no mesmo lugar é TROCADO, não duplicado', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/'), ['a=1'], AGORA);
  pote.guardar(u('http://h/'), ['a=2'], AGORA);
  assert.equal(pote.cabecalho(u('http://h/'), AGORA), 'a=2');
});

test('lista e limpar', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/'), ['a=1'], AGORA);
  assert.deepEqual(pote.lista(AGORA).map((c) => [c.nome, c.valor, c.dominio, c.caminho]), [['a', '1', 'h', '/']]);
  pote.limpar();
  assert.equal(pote.cabecalho(u('http://h/'), AGORA), null);
});

// ---- achados da revisão de 28/10 ----

test('Domain de um rótulo só (Domain=com) é recusado: iria para todo .com', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://a.com/'), ['x=1; Domain=com'], AGORA);
  assert.equal(pote.cabecalho(u('http://b.com/'), AGORA), null);
});

test('host IP: Domain só se for o PRÓPRIO IP', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://10.0.0.1/'), ['a=1; Domain=0.0.1', 'b=2; Domain=10.0.0.1'], AGORA);
  assert.equal(pote.cabecalho(u('http://20.0.0.1/'), AGORA), null);
  assert.equal(pote.cabecalho(u('http://10.0.0.1/'), AGORA), 'b=2');
});

test('Secure recebido por http é recusado', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/'), ['s=1; Secure'], AGORA);
  assert.equal(pote.lista(AGORA).length, 0);
});

test('Max-Age vazio é ignorado (não apaga o cookie)', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/'), ['a=1; Max-Age='], AGORA);
  assert.equal(pote.cabecalho(u('http://h/'), AGORA), 'a=1');
});

test('o mesmo nome, um só deste host e outro do domínio: os dois ficam', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://exemplo.test/'), ['a=host', 'a=dominio; Domain=exemplo.test'], AGORA);
  assert.equal(pote.lista(AGORA).length, 2);
});

test('o pote tem teto: os mais velhos saem', () => {
  const pote = new PoteDeCookies();
  pote.guardar(u('http://h/'), Array.from({ length: 400 }, (_, i) => `c${i}=1`), AGORA);
  const lista = pote.lista(AGORA);
  assert.equal(lista.length, 300);
  assert.equal(lista[0].nome, 'c100');
});
