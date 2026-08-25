import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dentroDaRaiz,
  ehOculto,
  juntar,
  nomeDe,
  normalizarRemoto,
  paiDe,
  resolverDaRaiz,
} from '../remoto/caminho';

// ---------------------------------------------------------------------------
// Normalizar
// ---------------------------------------------------------------------------

test('normaliza barras repetidas, ponto e o fim', () => {
  assert.equal(normalizarRemoto('/opt//nvm/'), '/opt/nvm');
  assert.equal(normalizarRemoto('/opt/./nvm'), '/opt/nvm');
  assert.equal(normalizarRemoto('/'), '/');
  assert.equal(normalizarRemoto(''), '/');
  assert.equal(normalizarRemoto('opt/nvm'), '/opt/nvm');
});

test('resolve `..` sem sair da raiz do caminho', () => {
  assert.equal(normalizarRemoto('/opt/nvm/..'), '/opt');
  assert.equal(normalizarRemoto('/opt/../var/log'), '/var/log');
  // Subir demais para em `/`, e não vira `/..`.
  assert.equal(normalizarRemoto('/../../etc'), '/etc');
});

test('barra invertida no nome NÃO é separador', () => {
  // Um arquivo pode se chamar com barra invertida num servidor Linux, e isso
  // continua sendo um nome só — não dois níveis.
  const nome = String.fromCharCode(92);
  assert.equal(normalizarRemoto(`/tmp/a${nome}b`), `/tmp/a${nome}b`);
});

test('pai e nome', () => {
  assert.equal(paiDe('/opt/nvm/versions'), '/opt/nvm');
  assert.equal(paiDe('/opt'), '/');
  assert.equal(paiDe('/'), '/');
  assert.equal(nomeDe('/opt/nvm'), 'nvm');
  assert.equal(nomeDe('/'), '/');
});

test('juntar não duplica nem come barra', () => {
  assert.equal(juntar('/opt', 'nvm'), '/opt/nvm');
  assert.equal(juntar('/opt/', '/nvm'), '/opt/nvm');
  assert.equal(juntar('/', 'etc'), '/etc');
});

// ---------------------------------------------------------------------------
// A cerca do `Prune Root` (AC-13)
// ---------------------------------------------------------------------------

test('dentro da raiz aceita a própria raiz e o que está abaixo', () => {
  assert.equal(dentroDaRaiz('/srv/app', '/srv/app'), true);
  assert.equal(dentroDaRaiz('/srv/app', '/srv/app/logs'), true);
  assert.equal(dentroDaRaiz('/', '/qualquer/coisa'), true);
});

test('dentro da raiz RECUSA o que escapa, inclusive por `..`', () => {
  assert.equal(dentroDaRaiz('/srv/app', '/srv'), false);
  assert.equal(dentroDaRaiz('/srv/app', '/etc/passwd'), false);
  assert.equal(dentroDaRaiz('/srv/app', '/srv/app/../../etc'), false);
});

test('a cerca compara COMPONENTE, e não prefixo de texto', () => {
  // `/srv/app2` começa com `/srv/app` e não está dentro dele. Comparar texto
  // deixaria passar — é o mesmo cuidado do `arquivoDe` da spec 038.
  assert.equal(dentroDaRaiz('/srv/app', '/srv/app2'), false);
  assert.equal(dentroDaRaiz('/srv/app', '/srv/appdata/x'), false);
});

test('resolverDaRaiz devolve o absoluto quando cabe, e null quando escapa', () => {
  assert.equal(resolverDaRaiz('/srv/app', ['logs', 'hoje']), '/srv/app/logs/hoje');
  assert.equal(resolverDaRaiz('/srv/app', []), '/srv/app');
  assert.equal(resolverDaRaiz('/srv/app', ['..', '..', 'etc']), null);
  // Nome com barra dentro não pode virar dois níveis.
  assert.equal(resolverDaRaiz('/srv/app', ['a/b']), null);
});

test('componente vazio ou com NUL é recusado', () => {
  assert.equal(resolverDaRaiz('/srv', ['']), null);
  assert.equal(resolverDaRaiz('/srv', [`a${String.fromCharCode(0)}b`]), null);
});

// ---------------------------------------------------------------------------
// Ocultos
// ---------------------------------------------------------------------------

test('oculto é o que começa com ponto — e ponto e ponto-ponto não contam', () => {
  assert.equal(ehOculto('.env'), true);
  assert.equal(ehOculto('env'), false);
  assert.equal(ehOculto('.'), false);
  assert.equal(ehOculto('..'), false);
});
