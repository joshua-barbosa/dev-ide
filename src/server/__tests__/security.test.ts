import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedRequest } from '../http/security';

test('aceita Host de loopback com e sem porta', () => {
  for (const host of ['localhost', 'localhost:4321', '127.0.0.1', '127.0.0.1:4321', '[::1]:4321']) {
    assert.equal(isAllowedRequest({ host }), true, `deveria aceitar host "${host}"`);
  }
});

test('rejeita Host externo (DNS rebinding)', () => {
  for (const host of ['evil.com', 'evil.com:4321', '10.0.0.5:4321', '192.168.0.10']) {
    assert.equal(isAllowedRequest({ host }), false, `deveria rejeitar host "${host}"`);
  }
});

test('rejeita Host que apenas parece loopback', () => {
  for (const host of ['localhost.evil.com', '127.0.0.1.evil.com', 'notlocalhost', 'evil.com#localhost']) {
    assert.equal(isAllowedRequest({ host }), false, `deveria rejeitar host "${host}"`);
  }
});

test('rejeita requisição sem Host', () => {
  assert.equal(isAllowedRequest({}), false);
  assert.equal(isAllowedRequest({ host: '' }), false);
});

test('aceita Origin de loopback', () => {
  for (const origin of ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321']) {
    assert.equal(isAllowedRequest({ host: 'localhost:4321', origin }), true, origin);
  }
});

test('rejeita Origin de outro site mesmo com Host válido', () => {
  for (const origin of ['https://evil.com', 'http://evil.com:4321', 'null', 'http://localhost.evil.com']) {
    assert.equal(isAllowedRequest({ host: 'localhost:4321', origin }), false, origin);
  }
});

test('ausência de Origin é permitida (navegação direta e curl)', () => {
  assert.equal(isAllowedRequest({ host: 'localhost:4321' }), true);
});
