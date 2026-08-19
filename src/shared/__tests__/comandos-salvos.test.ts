import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acrescentar, MAX_COMANDO, MAX_NOME, normalizarLista, remover, scriptsDoManifesto,
  validarComando, type ComandoSalvo,
} from '../comandos-salvos';

const salvo = (nome: string, id = nome): ComandoSalvo => ({
  id, nome, comando: `echo ${nome}`, destino: 'shell',
});

// ---- fronteira rígida ----

test('validar aceita o que está completo', () => {
  assert.deepEqual(
    validarComando({ nome: ' build ', comando: ' npm run build ', destino: 'shell' }),
    { nome: 'build', comando: 'npm run build', destino: 'shell' }
  );
});

test('validar recusa nome ou comando vazio', () => {
  assert.throws(() => validarComando({ nome: '', comando: 'x', destino: 'shell' }), /nome/);
  assert.throws(() => validarComando({ nome: 'a', comando: '   ', destino: 'shell' }), /vazio/);
});

test('validar recusa destino inválido, dizendo quais valem', () => {
  assert.throws(
    () => validarComando({ nome: 'a', comando: 'b', destino: 'email' }),
    /shell, sql/
  );
  assert.throws(() => validarComando({ nome: 'a', comando: 'b' }), /shell, sql/);
});

test('validar recusa nome repetido, sem diferenciar maiúsculas', () => {
  assert.throws(
    () => validarComando({ nome: 'BUILD', comando: 'x', destino: 'shell' }, [salvo('build')]),
    /Já existe/
  );
});

test('validar recusa texto absurdamente longo', () => {
  assert.throws(
    () => validarComando({ nome: 'a'.repeat(MAX_NOME + 1), comando: 'b', destino: 'shell' }),
    /nome passa/
  );
  assert.throws(
    () => validarComando({ nome: 'a', comando: 'b'.repeat(MAX_COMANDO + 1), destino: 'shell' }),
    /comando passa/
  );
});

// ---- fronteira tolerante ----

test('lista estragada no arquivo vira lista vazia, sem lançar', () => {
  for (const entrada of [undefined, null, 42, 'texto', {}]) {
    assert.deepEqual(normalizarLista(entrada), []);
  }
});

test('entrada incompleta é descartada e as boas sobrevivem', () => {
  const lista = normalizarLista([
    { id: 'a', nome: 'bom', comando: 'echo', destino: 'shell' },
    { id: '', nome: 'sem id', comando: 'echo', destino: 'shell' },
    { id: 'c', nome: '  ', comando: 'echo', destino: 'shell' },
    { id: 'd', nome: 'sem destino', comando: 'echo' },
    { id: 'e', nome: 'destino errado', comando: 'echo', destino: 'ftp' },
    null,
  ]);
  assert.deepEqual(lista.map((c) => c.nome), ['bom']);
});

// ---- lista ----

test('acrescentar e remover são imutáveis', () => {
  const antes = [salvo('a')];
  const depois = acrescentar(antes, salvo('b'));
  assert.equal(antes.length, 1);
  assert.equal(depois.length, 2);
  assert.deepEqual(remover(depois, 'a').map((c) => c.id), ['b']);
});

test('remover id inexistente não muda nada', () => {
  assert.equal(remover([salvo('a')], 'zzz').length, 1);
});

// ---- descoberta ----

test('scripts do package.json viram "npm run <nome>"', () => {
  const achados = scriptsDoManifesto(
    JSON.stringify({ scripts: { build: 'tsc', test: 'node --test' } }),
    'package.json'
  );
  assert.deepEqual(achados.map((c) => c.comando), ['npm run build', 'npm run test']);
  assert.deepEqual([...new Set(achados.map((c) => c.origem))], ['package.json']);
});

test('scripts do composer.json viram "composer run <nome>"', () => {
  const achados = scriptsDoManifesto(
    JSON.stringify({ scripts: { 'test-unit': 'phpunit' } }),
    'composer.json'
  );
  assert.deepEqual(achados.map((c) => c.comando), ['composer run test-unit']);
});

test('script em ARRAY do composer conta — quem executa é o composer', () => {
  const achados = scriptsDoManifesto(
    JSON.stringify({ scripts: { ci: ['@test', '@lint'] } }),
    'composer.json'
  );
  assert.deepEqual(achados.map((c) => c.comando), ['composer run ci']);
});

test('manifesto quebrado ou sem scripts devolve lista vazia', () => {
  for (const conteudo of ['{ isto não é json', '{}', '[]', '{"scripts": "texto"}', '{"scripts": []}']) {
    assert.deepEqual(scriptsDoManifesto(conteudo, 'package.json'), [], conteudo);
  }
});

test('valor de script que não é texto nem lista é ignorado', () => {
  const achados = scriptsDoManifesto(
    JSON.stringify({ scripts: { bom: 'tsc', ruim: 42, '': 'sem nome' } }),
    'package.json'
  );
  assert.deepEqual(achados.map((c) => c.nome), ['bom']);
});
