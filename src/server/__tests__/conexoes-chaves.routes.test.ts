// Rotas de chave-valor (spec 089).
//
// Driver de mentira: o que se prova aqui é o CONTRATO da rota — o que ela
// aceita, o que recusa e como distingue "não mexer no prazo" de "tirar o
// prazo". O comportamento contra Redis de verdade está em `redis.driver.test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { SessionPool } from '../connections/pool';
import { DriverRegistry } from '../connections/registry';
import { Vault } from '../connections/vault';
import { RememberedKey } from '../connections/remember';
import { errorEnvelope } from '../http/handlers';
import { createConnectionsRouter } from '../routes/connections';
import { padroes } from '../../shared/prefs';
import type { Driver, EscritaDeChave, Session } from '../connections/types';

const SENHA = 'senha-mestra';
const gravacoes: EscritaDeChave[] = [];

function driverDeChaves(): Driver {
  return {
    type: 'kv-fake',
    label: 'KV',
    kind: 'kv',
    panel: 'database',
    icon: 'database',
    fields: [{ name: 'host', label: 'Host', type: 'string', required: true }],
    connect: async (): Promise<Session> => ({
      kind: 'kv',
      children: async () => [],
      readKey: async (chave) => {
        if (chave === 'sumiu') throw new Error(`A chave "${chave}" não existe.`);
        return {
          chave, tipo: 'string', ttl: -1, forma: 'texto', texto: `valor de ${chave}`,
          cortado: false,
        };
      },
      writeKey: async (pedido) => { gravacoes.push(pedido); },
      deleteKey: async (pedido) => (pedido.prefixo === undefined ? 1 : 7),
      estadoDoServidor: async () => ({
        versao: '8.6.2', modo: 'standalone', papel: 'master', so: 'Linux',
        uptime: 100, memoria: '1M', clientes: 2,
        bancos: [{ nome: 'db0', chaves: 3, expiram: 0, ttlMedio: 0 }],
        bruto: '# Server',
      }),
      close: async () => {},
    }),
  };
}

/** Driver SQL comum: não guarda chaves, e a rota tem de dizer isso. */
function driverSql(): Driver {
  return {
    type: 'sql-fake',
    label: 'SQL',
    kind: 'sql',
    panel: 'database',
    icon: 'database',
    fields: [{ name: 'host', label: 'Host', type: 'string', required: true }],
    connect: async (): Promise<Session> => ({
      kind: 'sql', children: async () => [], close: async () => {},
    }),
  };
}

async function bootstrap() {
  const vaultPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-chaves-')), 'vault.json'
  );
  const registry = new DriverRegistry();
  registry.register(driverDeChaves());
  registry.register(driverSql());
  const vault = new Vault(vaultPath);
  const pool = new SessionPool(
    async (id) => registry.get(vault.resolve(id).type).connect(vault.resolve(id))
  );
  const remember = new RememberedKey(
    path.join(path.dirname(vaultPath), 'session.json'),
    () => 'maquina-de-teste-aaaaaaaaaaaaaaaa'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/connections', createConnectionsRouter({
    registry, vault, pool, remember, prefs: { ler: padroes },
  }));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/connections`;

  const call = async (method: string, rota: string, body?: unknown) => {
    const res = await fetch(base + rota, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, payload: (await res.json()) as {
      success: boolean; data: any; error: string;
    } };
  };

  await call('POST', '/vault', { password: SENHA });
  const criada = await call('POST', '/', {
    type: 'kv-fake', label: 'cache', group: '', readOnly: false, fields: { host: '127.0.0.1' },
  });
  const doSql = await call('POST', '/', {
    type: 'sql-fake', label: 'banco', group: '', readOnly: false, fields: { host: '127.0.0.1' },
  });

  return {
    call,
    id: criada.payload.data.id as string,
    idSql: doSql.payload.data.id as string,
    close: () => new Promise((r) => server.close(() => r(null))),
  };
}

test('lê a chave e devolve tipo, prazo e valor', async () => {
  const { call, id, close } = await bootstrap();
  const r = await call('GET', `/${id}/key?name=saudacao`);
  assert.equal(r.payload.success, true);
  assert.equal(r.payload.data.texto, 'valor de saudacao');
  assert.equal(r.payload.data.tipo, 'string');
  await close();
});

test('chave sem nome é recusada, e não vira leitura de vazio', async () => {
  const { call, id, close } = await bootstrap();
  const r = await call('GET', `/${id}/key?name=`);
  assert.equal(r.payload.success, false);
  assert.match(r.payload.error, /qual chave/);
  await close();
});

test('conexão que NÃO guarda chaves diz isso, em vez de responder vazio', async () => {
  const { call, idSql, close } = await bootstrap();
  const r = await call('GET', `/${idSql}/key?name=x`);
  assert.equal(r.payload.success, false);
  assert.match(r.payload.error, /não guarda chaves/);
  await close();
});

test('tipo desconhecido é recusado pelo NOME, e não vira comando', async () => {
  const { call, id, close } = await bootstrap();
  const r = await call('PUT', `/${id}/key`, { chave: 'k', tipo: 'INVENTADO', valor: 'x' });
  assert.equal(r.payload.success, false);
  assert.match(r.payload.error, /Tipo de chave desconhecido/);
  await close();
});

test('"não mexer no prazo" e "tirar o prazo" são coisas DIFERENTES', async () => {
  const { call, id, close } = await bootstrap();
  gravacoes.length = 0;

  await call('PUT', `/${id}/key`, { chave: 'k', tipo: 'string', valor: 'novo' });
  assert.equal('ttl' in gravacoes[0]!, false, 'sem ttl no corpo, o prazo não pode ser tocado');

  await call('PUT', `/${id}/key`, { chave: 'k', tipo: 'string', ttl: null });
  assert.equal(gravacoes[1]!.ttl, -1, 'null é TIRAR o prazo');

  await call('PUT', `/${id}/key`, { chave: 'k', tipo: 'string', ttl: 90.7 });
  assert.equal(gravacoes[2]!.ttl, 90, 'segundo quebrado é aparado');
  await close();
});

test('apagar por nome e por prefixo devolvem quantas foram', async () => {
  const { call, id, close } = await bootstrap();
  assert.equal((await call('DELETE', `/${id}/key?name=k`)).payload.data.apagadas, 1);
  assert.equal((await call('DELETE', `/${id}/key?prefix=lote:`)).payload.data.apagadas, 7);
  await close();
});

test('o estado do servidor sai com os bancos', async () => {
  const { call, id, idSql, close } = await bootstrap();
  const r = await call('GET', `/${id}/server-state`);
  assert.equal(r.payload.data.versao, '8.6.2');
  assert.equal(r.payload.data.bancos[0].chaves, 3);

  const semEstado = await call('GET', `/${idSql}/server-state`);
  assert.equal(semEstado.payload.success, false);
  await close();
});
