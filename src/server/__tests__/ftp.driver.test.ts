import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ftpDriver, CAMPOS_FTP } from '../connections/drivers/ftp';
import { sshDriver } from '../connections/drivers/ssh';
import { DRIVERS } from '../connections/drivers';

// A CONEXÃO com um servidor FTP não é testada aqui: a suíte não tem um, e a
// regra do projeto é não ficar vermelha em máquina que não tem servidor — a
// mesma dos drivers de banco. O que se prova aqui é o que não precisa de rede,
// e que é a razão de este driver existir agora: a FORMA da sessão.

test('o FTP entra no painel Service, ao lado do SSH', () => {
  assert.equal(ftpDriver.panel, 'service');
  assert.equal(ftpDriver.kind, 'files');
  assert.equal(DRIVERS.includes(ftpDriver), true);
});

test('a senha é o ÚNICO campo secreto', () => {
  assert.deepEqual(
    CAMPOS_FTP.filter((c) => c.secret === true).map((c) => c.name),
    ['password']
  );
});

test('os campos são os da tela de referência, e a porta é 21', () => {
  const nomes = CAMPOS_FTP.map((c) => c.name);
  for (const esperado of ['host', 'port', 'username', 'password', 'tls', 'root_path',
    'show_hidden', 'compatible', 'timeout', 'encoding']) {
    assert.equal(nomes.includes(esperado), true, esperado);
  }
  assert.equal(CAMPOS_FTP.find((c) => c.name === 'port')?.default, 21);
  assert.equal(CAMPOS_FTP.find((c) => c.name === 'username')?.default, 'anonymous');
  assert.equal(ftpDriver.defaultPort, 21);
});

test('a codificação é lista FECHADA — é o único valor que o servidor tem que aceitar', () => {
  const encoding = CAMPOS_FTP.find((c) => c.name === 'encoding');
  assert.equal(encoding?.type, 'select');
  assert.deepEqual(encoding?.options?.map((o) => o.value), ['utf8', 'latin1']);
});

test('o FTP NÃO tem cliente de linha de comando, e o SSH também não', () => {
  // Os dois abrem terminal (ou não) pela capacidade da SESSÃO, e não por um
  // binário local — é o que a spec 054 mudou.
  assert.equal(ftpDriver.cli, undefined);
  assert.equal(sshDriver.cli, undefined);
});
