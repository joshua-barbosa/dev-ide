import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriverRegistry } from '../connections/registry';
import type { Driver, Session } from '../connections/types';

function driverFake(type = 'fake'): Driver {
  return {
    type,
    label: 'Fake',
    kind: 'sql',
    panel: 'database',
    icon: 'database',
    defaultPort: 1234,
    fields: [
      { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1' },
      { name: 'port', label: 'Porta', type: 'number', default: 1234 },
      { name: 'user', label: 'Usuário', type: 'string', required: true },
      { name: 'password', label: 'Senha', type: 'password', secret: true },
      { name: 'ssl', label: 'SSL', type: 'boolean', default: false },
      {
        name: 'ssl_mode',
        label: 'SSL Mode',
        type: 'select',
        default: 'PREFERRED',
        options: [
          { value: 'DISABLED', label: 'Desabilitado' },
          { value: 'PREFERRED', label: 'Preferencial' },
          { value: 'REQUIRED', label: 'Obrigatório' },
        ],
      },
    ],
    connect: async (): Promise<Session> => ({
      kind: 'sql',
      children: async () => [],
      close: async () => {},
    }),
  };
}

test('registra e recupera driver', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.equal(registry.has('fake'), true);
  assert.equal(registry.get('fake').label, 'Fake');
});

test('recusa registrar o mesmo tipo duas vezes', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.throws(() => registry.register(driverFake()), /já registrado/i);
});

test('erro claro para tipo desconhecido', () => {
  const registry = new DriverRegistry();
  assert.throws(() => registry.get('oracle'), /desconhecido/i);
});

test('list descreve os drivers para a UI montar o formulário', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake('mysql'));
  registry.register(driverFake('redis'));

  const lista = registry.list();
  assert.deepEqual(lista.map((d) => d.type), ['mysql', 'redis']);
  assert.deepEqual(
    lista[0].fields.map((f) => f.name),
    ['host', 'port', 'user', 'password', 'ssl', 'ssl_mode']
  );
  assert.equal(lista[0].defaultPort, 1234);
});

test('list informa em qual painel o driver aparece', () => {
  // A divisão Database/Service é declarada pelo driver, não derivada de `kind`:
  // Redis (kv) e Pinecone (vector) são armazenamento e vão para Database.
  const registry = new DriverRegistry();
  registry.register({ ...driverFake('redis'), kind: 'kv', panel: 'database' });
  registry.register({ ...driverFake('ssh'), kind: 'shell', panel: 'service' });

  const porTipo = new Map(registry.list().map((d) => [d.type, d.panel]));
  assert.equal(porTipo.get('redis'), 'database', 'kv também é armazenamento');
  assert.equal(porTipo.get('ssh'), 'service');
});

test('secretFields aponta os campos que vão cifrados', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.deepEqual(registry.secretFields('fake'), ['password']);
});

// ---- validação de entrada ----

test('aplica defaults dos campos ausentes', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  const campos = registry.validate('fake', { user: 'root' });
  assert.equal(campos.host, '127.0.0.1');
  assert.equal(campos.port, 1234);
  assert.equal(campos.ssl, false);
});

test('exige campos obrigatórios sem default', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.throws(() => registry.validate('fake', {}), /user/i);
});

test('converte número e booleano vindos como texto do formulário', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  const campos = registry.validate('fake', { user: 'root', port: '3306', ssl: 'true' });
  assert.equal(campos.port, 3306);
  assert.equal(campos.ssl, true);
});

test('rejeita número inválido', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.throws(() => registry.validate('fake', { user: 'root', port: 'abc' }), /port/i);
});

test('rejeita campo desconhecido', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.throws(() => registry.validate('fake', { user: 'root', drop: 'table' }), /desconhecid/i);
});

test('select aceita valor da lista e recusa fora dela', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());

  assert.equal(registry.validate('fake', { user: 'root', ssl_mode: 'REQUIRED' }).ssl_mode, 'REQUIRED');
  assert.equal(registry.validate('fake', { user: 'root' }).ssl_mode, 'PREFERRED', 'default do select');
  assert.throws(
    () => registry.validate('fake', { user: 'root', ssl_mode: 'INVENTADO' }),
    /SSL Mode|ssl_mode/
  );
});

test('a mensagem do select lista os valores aceitos', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  assert.throws(() => registry.validate('fake', { user: 'root', ssl_mode: 'x' }), /DISABLED.*PREFERRED.*REQUIRED/s);
});

test('list entrega as opções do select para a UI', () => {
  const registry = new DriverRegistry();
  registry.register(driverFake());
  const campo = registry.list()[0].fields.find((f) => f.name === 'ssl_mode');
  assert.deepEqual(campo?.options?.map((o) => o.value), ['DISABLED', 'PREFERRED', 'REQUIRED']);
});
