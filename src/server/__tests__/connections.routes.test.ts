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
import type { Driver, Session } from '../connections/types';

const SENHA = 'senha-mestra';

/** Driver de teste: cobre árvore + execute, sem tocar em rede. */
function driverFake(): Driver {
  return {
    type: 'fake',
    label: 'Fake',
    kind: 'sql',
    panel: 'database',
    icon: 'database',
    defaultPort: 1234,
    fields: [
      { name: 'host', label: 'Host', type: 'string', required: true },
      { name: 'password', label: 'Senha', type: 'password', secret: true },
    ],
    connect: async (config): Promise<Session> => ({
      kind: 'sql',
      children: async (nodePath) => [
        {
          id: nodePath.join('/') || 'raiz',
          // Devolve o host resolvido para provar que o segredo chegou ao driver.
          label: `${config.fields.host}:${config.fields.password}`,
          icon: 'schema',
          hasChildren: false,
        },
      ],
      execute: async (request) => ({
        columns: [{ name: 'echo', type: 'text' }],
        rows: [[request.statement]],
        rowCount: 1,
        durationMs: 0,
        truncated: false,
      }),
      close: async () => {},
    }),
  };
}

/** Driver sem `execute`, para provar que a rota recusa comando em conexão que não executa. */
function driverSemExecute(): Driver {
  return {
    type: 'so-arvore',
    label: 'Só Árvore',
    kind: 'files',
    panel: 'service',
    icon: 'folder',
    fields: [{ name: 'host', label: 'Host', type: 'string', required: true }],
    connect: async (): Promise<Session> => ({
      kind: 'files',
      children: async () => [],
      close: async () => {},
    }),
  };
}

async function bootstrap() {
  const vaultPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-rotas-')), 'vault.json');
  const registry = new DriverRegistry();
  registry.register(driverFake());
  registry.register(driverSemExecute());
  const vault = new Vault(vaultPath);
  const pool = new SessionPool(async (id) => registry.get(vault.resolve(id).type).connect(vault.resolve(id)));
  const rememberPath = path.join(path.dirname(vaultPath), 'session.json');
  const remember = new RememberedKey(rememberPath, () => 'maquina-de-teste-aaaaaaaaaaaaaaaa');

  const app = express();
  app.use(express.json());
  app.use('/api/connections', createConnectionsRouter({ registry, vault, pool, remember, prefs: { ler: padroes } }));
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
    return { status: res.status, payload: (await res.json()) as { success: boolean; data: any; error: string } };
  };

  return { call, vaultPath, rememberPath, pool, close: () => new Promise((r) => server.close(() => r(null))) };
}

const CONEXAO = {
  type: 'fake',
  label: 'servidor-2',
  group: '/ACME//Bancos/',
  readOnly: true,
  fields: { host: '10.0.0.1', password: 'segredo-forte' },
};

test('rotas de conexão', async (t) => {
  const { call, vaultPath, rememberPath, pool, close } = await bootstrap();
  t.after(close);

  await t.test('lista drivers para a UI montar o formulário', async () => {
    const { payload } = await call('GET', '/drivers');
    assert.deepEqual(payload.data.map((d: { type: string }) => d.type), ['fake', 'so-arvore']);
    assert.equal(payload.data[0].fields[1].secret, true);
  });

  await t.test('cofre inexistente devolve árvore vazia, não erro', async () => {
    const { status, payload } = await call('GET', '/');
    assert.equal(status, 200);
    assert.deepEqual(payload.data.vault, {
      exists: false, unlocked: false, rememberedUntil: null, canRemember: true,
    });
    assert.deepEqual(payload.data.tree.connections, []);
  });

  await t.test('cria o cofre', async () => {
    const { status, payload } = await call('POST', '/vault', { password: SENHA });
    assert.equal(status, 201);
    assert.equal(payload.data.unlocked, true);
  });

  let id = '';

  await t.test('cria conexão sem devolver o segredo', async () => {
    const { status, payload } = await call('POST', '/', CONEXAO);
    assert.equal(status, 201);
    id = payload.data.id;
    assert.equal(payload.data.fields.password, undefined, 'senha não pode voltar na resposta');
    assert.deepEqual(payload.data.secretFields, ['password']);
    assert.equal(payload.data.group, 'ACME/Bancos', 'grupo deve chegar normalizado');
  });

  await t.test('a resposta da listagem também não carrega segredo', async () => {
    const { payload } = await call('GET', '/');
    const bancos = payload.data.tree.groups[0].groups[0];
    assert.equal(bancos.path, 'ACME/Bancos');
    assert.equal(bancos.connections[0].fields.password, undefined);
    assert.ok(!JSON.stringify(payload).includes('segredo-forte'), 'segredo vazou na resposta');
  });

  await t.test('valida a entrada na fronteira', async () => {
    const semLabel = await call('POST', '/', { ...CONEXAO, label: '' });
    assert.equal(semLabel.status, 400);
    assert.match(semLabel.payload.error, /label/);

    const campoInvalido = await call('POST', '/', { ...CONEXAO, fields: { host: 'x', drop: 'y' } });
    assert.match(campoInvalido.payload.error, /desconhecid/i);

    const tipoInvalido = await call('POST', '/', { ...CONEXAO, type: 'oracle' });
    assert.match(tipoInvalido.payload.error, /desconhecido/i);
  });

  await t.test('conecta e informa as capacidades da sessão', async () => {
    const { payload } = await call('POST', `/${id}/connect`);
    assert.deepEqual(payload.data, {
      kind: 'sql',
      execute: true,
      files: false,
      shell: false,
      monitor: false,
      forwarding: false,
      // Onde a tabela SFTP abre (spec 055). Quem não navega arquivos manda `/`
      // e ninguém olha — mas o campo existe para não haver dois formatos de
      // resposta.
      rootPath: '/',
      // O que a tela digita quando o prompt aparecer (spec 061). Vazio para
      // quem não tem terminal — e o campo existe para não haver dois formatos
      // de resposta.
      comandoDeTerminal: '',
    });
  });

  await t.test('o segredo decifrado chega ao driver', async () => {
    const { payload } = await call('GET', `/${id}/children?path=schema`);
    assert.equal(payload.data[0].label, '10.0.0.1:segredo-forte');
    assert.equal(payload.data[0].id, 'schema');
  });

  await t.test('executa comando', async () => {
    const { payload } = await call('POST', `/${id}/execute`, { statement: 'SELECT 1' });
    assert.deepEqual(payload.data.rows, [['SELECT 1']]);
    assert.equal(payload.data.columns[0].name, 'echo');
  });

  await t.test('recusa comando em conexão que não executa', async () => {
    const criada = await call('POST', '/', {
      type: 'so-arvore',
      label: 'sftp',
      group: '',
      readOnly: false,
      fields: { host: 'h' },
    });
    const { status, payload } = await call('POST', `/${criada.payload.data.id}/execute`, { statement: 'x' });
    assert.equal(status, 400);
    assert.match(payload.error, /não executa comandos/);
  });

  await t.test('renomear grupo reescreve o prefixo dos descendentes', async () => {
    const { payload } = await call('POST', '/groups/rename', { from: 'ACME', to: 'ACME SA' });
    assert.equal(payload.data.renomeadas, 1);

    const lista = await call('GET', '/');
    assert.equal(lista.payload.data.tree.groups[0].name, 'ACME SA');
    assert.equal(lista.payload.data.tree.groups[0].groups[0].path, 'ACME SA/Bancos');
  });

  await t.test('atualiza sem perder o segredo', async () => {
    await call('PATCH', `/${id}`, { label: 'servidor-2-prod' });
    const { payload } = await call('GET', `/${id}/children`);
    assert.equal(payload.data[0].label, '10.0.0.1:segredo-forte');
  });

  await t.test('trancar o cofre fecha as sessões abertas', async () => {
    assert.ok(pool.openIds().length > 0, 'deveria haver sessão aberta antes');
    const { payload } = await call('POST', '/vault/lock');
    assert.equal(payload.data.unlocked, false);
    assert.deepEqual(pool.openIds(), []);

    const bloqueado = await call('GET', `/${id}/children`);
    assert.equal(bloqueado.status, 400);
    assert.match(bloqueado.payload.error, /trancado/i);
  });

  await t.test('destranca e volta a funcionar', async () => {
    const errada = await call('POST', '/vault/unlock', { password: 'errada' });
    assert.match(errada.payload.error, /senha/i);

    await call('POST', '/vault/unlock', { password: SENHA });
    const { payload } = await call('GET', `/${id}/children`);
    assert.equal(payload.data[0].label, '10.0.0.1:segredo-forte');
  });

  await t.test('remove a conexão', async () => {
    await call('DELETE', `/${id}`);
    const { payload } = await call('GET', '/');
    const nomes = JSON.stringify(payload.data.tree);
    assert.ok(!nomes.includes('servidor-2-prod'));
  });


  await t.test('destrancar sem pedir para lembrar não deixa rastro em disco', async () => {
    await call('POST', '/vault/lock');
    const { payload } = await call('POST', '/vault/unlock', { password: SENHA });
    assert.equal(payload.data.unlocked, true);
    assert.equal(payload.data.rememberedUntil, null);
    assert.equal(fs.existsSync(rememberPath), false, 'não deveria haver lembrança');
  });

  await t.test('destrancar pedindo para lembrar grava e informa a validade', async () => {
    await call('POST', '/vault/lock');
    const { payload } = await call('POST', '/vault/unlock', { password: SENHA, remember: true });

    assert.ok(payload.data.rememberedUntil, 'deveria informar até quando vale');
    assert.ok(Date.parse(payload.data.rememberedUntil) > Date.now());
    assert.equal(fs.existsSync(rememberPath), true);
    assert.equal(fs.statSync(rememberPath).mode & 0o777, 0o600);
  });

  await t.test('a senha mestra não aparece no arquivo de lembrança', () => {
    assert.ok(!fs.readFileSync(rememberPath, 'utf8').includes(SENHA), 'senha vazou');
  });

  await t.test('o estado geral também informa a lembrança', async () => {
    const { payload } = await call('GET', '/');
    assert.ok(payload.data.vault.rememberedUntil);
    assert.equal(payload.data.vault.canRemember, true);
  });

  await t.test('trancar apaga a lembrança', async () => {
    const { payload } = await call('POST', '/vault/lock');
    assert.equal(payload.data.rememberedUntil, null);
    assert.equal(fs.existsSync(rememberPath), false, 'trancar deve apagar a lembrança');
    await call('POST', '/vault/unlock', { password: SENHA });
  });

  await t.test('senha errada não grava lembrança', async () => {
    await call('POST', '/vault/lock');
    const { payload } = await call('POST', '/vault/unlock', { password: 'errada', remember: true });
    assert.match(payload.error, /senha/i);
    assert.equal(fs.existsSync(rememberPath), false);
    await call('POST', '/vault/unlock', { password: SENHA });
  });

  await t.test('o arquivo do cofre nunca teve a senha em claro', () => {
    assert.ok(!fs.readFileSync(vaultPath, 'utf8').includes('segredo-forte'));
  });
});
