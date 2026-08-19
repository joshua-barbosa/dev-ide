import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { errorEnvelope } from '../http/handlers';
import { PreferencesStore } from '../prefs';
import { createPrefsRouter } from '../routes/prefs';
import { padroes } from '../../shared/prefs';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

async function comServidor(
  fn: (
    call: (method: string, rota: string, body?: unknown) => Promise<Envelope<unknown>>,
    arquivo: string
  ) => Promise<void>
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-prefs-rota-'));
  const arquivo = path.join(dir, 'config.json');

  const app = express();
  app.use(express.json());
  app.use('/api/prefs', createPrefsRouter(new PreferencesStore(arquivo)));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const call = async (method: string, rota: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/prefs${rota}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as Envelope<unknown>;
  };

  try {
    await fn(call, arquivo);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('GET devolve o conjunto completo, com os padrões', async () => {
  await comServidor(async (call) => {
    const r = await call('GET', '/');
    assert.equal(r.success, true);
    assert.deepEqual(r.data, padroes());
  });
});

test('PATCH aplica parcialmente e devolve o conjunto completo', async () => {
  await comServidor(async (call) => {
    const r = await call('PATCH', '/', { 'editor.fontSize': 18 });
    const dados = r.data as Record<string, unknown>;
    assert.equal(dados['editor.fontSize'], 18);
    assert.equal(dados['editor.tabSize'], 4, 'o que não veio no patch fica como estava');

    const depois = (await call('GET', '/')).data as Record<string, unknown>;
    assert.equal(depois['editor.fontSize'], 18);
  });
});

test('PATCH com chave desconhecida é recusado', async () => {
  await comServidor(async (call) => {
    const r = await call('PATCH', '/', { 'algo.inventado': 1 });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /desconhecida/);
  });
});

test('PATCH com valor fora da faixa é recusado e não grava nada', async () => {
  await comServidor(async (call) => {
    const r = await call('PATCH', '/', { 'editor.fontSize': 900 });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /editor\.fontSize/);

    const depois = (await call('GET', '/')).data as Record<string, unknown>;
    assert.equal(depois['editor.fontSize'], 13);
  });
});

test('POST /file cria o arquivo e devolve o caminho', async () => {
  await comServidor(async (call, arquivo) => {
    const r = await call('POST', '/file');
    assert.equal((r.data as { path: string }).path, arquivo);
    assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')), padroes());
  });
});
