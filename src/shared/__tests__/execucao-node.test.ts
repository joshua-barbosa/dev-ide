// Com que binário rodar JavaScript (T094).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ambienteDeNode } from '../execucao-node';

test('no navegador, o execPath JÁ é o node — nada a acrescentar', () => {
  const r = ambienteDeNode('/usr/bin/node', undefined, { PATH: '/bin' });
  assert.equal(r.binario, '/usr/bin/node');
  assert.equal(r.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(r.env.PATH, '/bin', 'o resto do ambiente passa inteiro');
});

test('no Electron, o mesmo binário vira NODE PURO pelo ambiente', () => {
  // Sem isto, executar um arquivo lançava uma segunda cópia do aplicativo, que
  // abortava na checagem de sandbox — e a mensagem falava de sandbox, escondendo
  // que o defeito era de execução de código.
  const r = ambienteDeNode('/apps/braytech-code', '44.1.1', { PATH: '/bin' });
  assert.equal(r.binario, '/apps/braytech-code');
  assert.equal(r.env.ELECTRON_RUN_AS_NODE, '1');
});

test('a variável NÃO vaza para o modo navegador', () => {
  // Um ambiente herdado de um pai que a tinha faria o `node` do navegador
  // comportar-se de forma diferente sem ninguém pedir.
  const r = ambienteDeNode('/usr/bin/node', undefined, { ELECTRON_RUN_AS_NODE: '1' });
  assert.equal(r.env.ELECTRON_RUN_AS_NODE, undefined);
});

test('variável de ambiente sem valor não vira string "undefined"', () => {
  const r = ambienteDeNode('/usr/bin/node', undefined, { VAZIA: undefined, CHEIA: 'x' });
  assert.equal('VAZIA' in r.env, false);
  assert.equal(r.env.CHEIA, 'x');
});
