// Túnel aberto segura a sessão SSH contra a varredura de ociosidade.
//
// Mesmo defeito do terminal: o túnel pede a sessão uma vez, e o tráfego que
// passa por ele não toca no relógio do pool. Aos 10 minutos a varredura
// fechava a sessão e o túnel caía com o banco do outro lado em uso.
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
import type { Driver, PortForward, Session } from '../connections/types';

const DEZ_MIN = 10 * 60 * 1000;

async function montar() {
  let agora = 0;
  let fechadas = 0;
  let n = 0;
  const abertos = new Map<string, PortForward>();
  const driver: Driver = {
    type: 'tunel-fake', label: 'SSH', kind: 'shell', panel: 'service', icon: 'server',
    fields: [{ name: 'host', label: 'Host', type: 'string', required: true }],
    connect: async (): Promise<Session> => ({
      kind: 'shell',
      children: async () => [],
      forwarding: {
        list: async () => [...abertos.values()],
        open: async (remoteHost, remotePort, localPort) => {
          const f = { id: `f${++n}`, remoteHost, remotePort, localPort: localPort ?? 40000 + n };
          abertos.set(f.id, f);
          return f;
        },
        close: async (id) => { abertos.delete(id); },
      },
      close: async () => { fechadas += 1; },
    }),
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-tunel-'));
  const registry = new DriverRegistry();
  registry.register(driver);
  const vault = new Vault(path.join(dir, 'vault.json'));
  const pool = new SessionPool(
    async (id) => registry.get(vault.resolve(id).type).connect(vault.resolve(id)),
    { idleTimeoutMs: DEZ_MIN, now: () => agora }
  );
  const remember = new RememberedKey(path.join(dir, 'session.json'), () => 'maquina-aaaaaaaaaaaaaaaa');

  const app = express();
  app.use(express.json());
  app.use('/api/connections', createConnectionsRouter({
    registry, vault, pool, remember, prefs: { ler: padroes },
  }));
  app.use(errorEnvelope);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/connections`;
  const call = async (method: string, rota: string, body?: unknown) =>
    (await fetch(base + rota, {
      method,
      headers: body === undefined ? { Connection: 'close' } : { 'Content-Type': 'application/json', Connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json())) as { success: boolean; data: any };

  await call('POST', '/vault', { password: 'senha-mestra' });
  const id = (await call('POST', '/', {
    type: 'tunel-fake', label: 'servidor', group: '', readOnly: false, fields: { host: 'h' },
  })).data.id as string;

  return {
    call, id, pool,
    avancar: (ms: number) => { agora += ms; },
    fechadas: () => fechadas,
    close: () => new Promise((r) => server.close(() => r(null))),
  };
}

test('túnel aberto: a varredura não fecha a sessão, por mais tempo que passe', async () => {
  const t = await montar();
  try {
  const aberto = await t.call('POST', `/${t.id}/forwards`, { remoteHost: 'localhost', remotePort: 3306 });
  assert.equal(aberto.success, true);

  t.avancar(8 * 60 * 60 * 1000);
  await t.pool.sweep();

  assert.equal(t.fechadas(), 0);
  assert.ok(t.pool.isOpen(t.id));
  } finally { await t.close(); }
});

test('túnel fechado: a sessão volta à ociosidade normal', async () => {
  const t = await montar();
  try {
  const aberto = await t.call('POST', `/${t.id}/forwards`, { remoteHost: 'localhost', remotePort: 3306 });
  t.avancar(3 * DEZ_MIN);
  await t.call('DELETE', `/${t.id}/forwards/${aberto.data.id}`);

  await t.pool.sweep();
  assert.equal(t.fechadas(), 0, 'fechou no mesmo instante em que o túnel saiu');

  t.avancar(DEZ_MIN + 1);
  await t.pool.sweep();
  assert.equal(t.fechadas(), 1);
  } finally { await t.close(); }
});

test('fechar o mesmo túnel duas vezes não solta a retenção de OUTRO túnel', async () => {
  const t = await montar();
  try {
  const a = await t.call('POST', `/${t.id}/forwards`, { remoteHost: 'localhost', remotePort: 3306 });
  await t.call('POST', `/${t.id}/forwards`, { remoteHost: 'localhost', remotePort: 6379 });
  await t.call('DELETE', `/${t.id}/forwards/${a.data.id}`);
  await t.call('DELETE', `/${t.id}/forwards/${a.data.id}`);

  t.avancar(5 * DEZ_MIN);
  await t.pool.sweep();
  assert.equal(t.fechadas(), 0);
  } finally { await t.close(); }
});

test('desconectar com túnel aberto fecha a sessão, e reconectar não herda a retenção', async () => {
  const t = await montar();
  try {
    await t.call('POST', `/${t.id}/forwards`, { remoteHost: 'localhost', remotePort: 3306 });
    await t.call('POST', `/${t.id}/disconnect`);
    assert.equal(t.fechadas(), 1, 'desconectar de propósito não fechou');

    // Reconectou e ficou parada: a retenção do túnel antigo não vale aqui.
    await t.call('GET', `/${t.id}/forwards`);
    t.avancar(DEZ_MIN + 1);
    await t.pool.sweep();
    assert.equal(t.fechadas(), 2);
  } finally { await t.close(); }
});
