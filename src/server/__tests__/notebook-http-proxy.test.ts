// Que proxy a célula HTTP usa (spec 120, etapa 3). Decisão dele (28/10): o do
// sistema por padrão, e a célula pode apontar um próprio.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyPara } from '../notebook/proxy-http';

const u = (t: string) => new URL(t);

test('sem proxy no sistema nem na célula: direto', () => {
  assert.equal(proxyPara(u('http://h/x'), '', {}), null);
});

test('o da célula vale mais que o do sistema', () => {
  assert.equal(proxyPara(u('http://h/x'), 'http://meu:8080', { HTTP_PROXY: 'http://sis:3128' })?.host, 'meu:8080');
});

test('https usa HTTPS_PROXY; http usa HTTP_PROXY; minúsculas valem mais', () => {
  const env = { HTTP_PROXY: 'http://a:1', HTTPS_PROXY: 'http://b:2', https_proxy: 'http://c:3' };
  assert.equal(proxyPara(u('http://h/'), '', env)?.host, 'a:1');
  assert.equal(proxyPara(u('https://h/'), '', env)?.host, 'c:3');
});

test('https sem HTTPS_PROXY cai no HTTP_PROXY (o que o Postman faz)', () => {
  assert.equal(proxyPara(u('https://h/'), '', { HTTP_PROXY: 'http://a:1' })?.host, 'a:1');
});

test('NO_PROXY: host exato, sufixo com ou sem ponto, porta, e *', () => {
  const env = (no: string) => ({ HTTP_PROXY: 'http://p:1', NO_PROXY: no });
  assert.equal(proxyPara(u('http://interno.test/'), '', env('interno.test')), null);
  assert.equal(proxyPara(u('http://api.interno.test/'), '', env('.interno.test')), null);
  assert.equal(proxyPara(u('http://api.interno.test/'), '', env('interno.test')), null);
  assert.equal(proxyPara(u('http://outrointerno.test/'), '', env('interno.test'))?.host, 'p:1');
  assert.equal(proxyPara(u('http://h:8080/'), '', env('h:8080')), null);
  assert.equal(proxyPara(u('http://h:9090/'), '', env('h:8080'))?.host, 'p:1');
  assert.equal(proxyPara(u('http://qualquer/'), '', env('*')), null);
  assert.equal(proxyPara(u('http://127.0.0.1/'), '', env('localhost, 127.0.0.1')), null);
});

test('NO_PROXY não vale para o proxy escrito na célula: quem escreveu quis aquele', () => {
  assert.equal(proxyPara(u('http://interno.test/'), 'http://meu:1', { NO_PROXY: '*' })?.host, 'meu:1');
});

test('proxy sem esquema ganha http://; socks e https:// são recusados com recado', () => {
  assert.equal(proxyPara(u('http://h/'), 'proxy.local:3128', {})?.href, 'http://proxy.local:3128/');
  assert.throws(() => proxyPara(u('http://h/'), 'socks5://p:1080', {}), /só proxy http:\/\//);
  assert.throws(() => proxyPara(u('http://h/'), 'https://p:443', {}), /só proxy http:\/\//);
});

test('NO_PROXY com IPv6 (::1, [::1]) tira o loopback do proxy', () => {
  const env = (no: string) => ({ HTTP_PROXY: 'http://p:1', NO_PROXY: no });
  assert.equal(proxyPara(u('http://[::1]:8080/'), '', env('::1')), null);
  assert.equal(proxyPara(u('http://[::1]:8080/'), '', env('[::1]')), null);
  assert.equal(proxyPara(u('http://[::1]:8080/'), '', env('[::1]:9090'))?.host, 'p:1');
});
