import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { errorEnvelope } from '../http/handlers';
import { EstadoStore } from '../estado';
import { createWorkspaceRouter } from '../routes/workspace';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

interface Retrato {
  readonly pasta: string | null;
  readonly recentes: readonly string[];
  readonly arvore: readonly { name: string }[];
  readonly simbolos: readonly { name: string }[];
  readonly truncated: boolean;
}

type Chamada = (method: string, rota: string, body?: unknown) => Promise<Envelope<unknown>>;

async function comServidor(
  fn: (call: Chamada, dados: string, projeto: string) => Promise<void>
): Promise<void> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-ws-')));
  const projeto = path.join(dir, 'projeto');
  fs.mkdirSync(projeto);
  fs.writeFileSync(path.join(projeto, 'utils.ts'), 'export const VERSAO = "1.0";\n');

  const app = express();
  app.use(express.json());
  app.use('/api', createWorkspaceRouter(new EstadoStore(path.join(dir, 'state.json'))));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const call: Chamada = async (method, rota, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${rota}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as Envelope<unknown>;
  };

  try {
    await fn(call, dir, projeto);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a IDE começa sem pasta aberta', async () => {
  await comServidor(async (call) => {
    const r = (await call('GET', '/workspace')).data as Retrato;
    assert.equal(r.pasta, null);
    assert.deepEqual(r.arvore, []);
    assert.deepEqual(r.recentes, []);
  });
});

test('abrir uma pasta devolve árvore e símbolos de uma vez', async () => {
  await comServidor(async (call, _dados, projeto) => {
    const r = (await call('POST', '/workspace', { path: projeto })).data as Retrato;
    assert.equal(r.pasta, projeto);
    assert.deepEqual(r.arvore.map((n) => n.name), ['utils.ts']);
    assert.ok(r.simbolos.some((s) => s.name === 'VERSAO'), 'os símbolos vêm na mesma resposta');
  });
});

test('a pasta aberta sobrevive a uma nova leitura — é o que reabre a IDE onde estava', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    assert.equal(((await call('GET', '/workspace')).data as Retrato).pasta, projeto);
  });
});

test('abrir pasta inexistente é recusado e não entra no histórico', async () => {
  await comServidor(async (call, dados) => {
    const r = await call('POST', '/workspace', { path: path.join(dados, 'nao-existe') });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /não encontrada/);

    const depois = (await call('GET', '/workspace')).data as Retrato;
    assert.deepEqual(depois.recentes, []);
  });
});

test('pasta que sumiu desde a última sessão é esquecida, não insistida', async () => {
  await comServidor(async (call, dados) => {
    const temporaria = path.join(dados, 'some-depois');
    fs.mkdirSync(temporaria);
    await call('POST', '/workspace', { path: temporaria });
    fs.rmSync(temporaria, { recursive: true });

    const r = (await call('GET', '/workspace')).data as Retrato;
    assert.equal(r.pasta, null);
    assert.equal(r.recentes.includes(temporaria), false, 'sai do histórico junto');
  });
});

test('fechar solta a pasta e preserva o histórico', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = (await call('DELETE', '/workspace')).data as Retrato;
    assert.equal(r.pasta, null);
    assert.deepEqual(r.recentes, [projeto]);
  });
});

test('esquecer tira do histórico', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = (await call('DELETE', '/workspace/recent', { path: projeto })).data as Retrato;
    assert.deepEqual(r.recentes, []);
  });
});

// ---- navegador ----

test('o navegador lista subpastas e o pai', async () => {
  await comServidor(async (call, dados) => {
    const r = (await call('GET', `/folders?path=${encodeURIComponent(dados)}`)).data as {
      path: string; parent: string | null; dirs: { name: string }[];
    };
    assert.equal(r.path, dados);
    assert.equal(r.parent, path.dirname(dados));
    assert.deepEqual(r.dirs.map((d) => d.name), ['projeto']);
  });
});

test('sem caminho, o navegador começa na pasta pessoal', async () => {
  await comServidor(async (call) => {
    const r = (await call('GET', '/folders')).data as { path: string };
    assert.equal(r.path, path.resolve(os.homedir()));
  });
});

// ---- criar arquivo ----

test('criar arquivo sem pasta aberta é recusado com instrução', async () => {
  await comServidor(async (call) => {
    const r = await call('POST', '/workspace/file', { name: 'a.ts', content: '' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /Abra uma pasta/);
  });
});

test('criar arquivo grava dentro da pasta aberta', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/file', { name: 'sub/novo.ts', content: 'const a = 1;' });
    const criado = (r.data as { path: string }).path;
    assert.equal(criado, path.join(projeto, 'sub', 'novo.ts'));
    assert.equal(fs.readFileSync(criado, 'utf8'), 'const a = 1;');
  });
});

test('criar arquivo que escapa da pasta é recusado', async () => {
  await comServidor(async (call, dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/file', { name: '../fora.ts', content: 'x' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /dentro da pasta/);
    assert.equal(fs.existsSync(path.join(dados, 'fora.ts')), false);
  });
});

test('criar arquivo que já existe é recusado sem sobrescrever', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/file', { name: 'utils.ts', content: 'apagado!' });
    assert.equal(r.success, false);
    assert.match(fs.readFileSync(path.join(projeto, 'utils.ts'), 'utf8'), /VERSAO/);
  });
});
