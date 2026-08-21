import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { errorEnvelope } from '../http/handlers';
import { ComandosStore } from '../comandos';
import { EstadoStore } from '../estado';
import { createComandosRouter } from '../routes/comandos';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

interface Listagem {
  readonly salvos: readonly { id: string; nome: string; destino: string }[];
  readonly descobertos: readonly { nome: string; comando: string; origem: string }[];
}

type Chamada = (method: string, rota: string, body?: unknown) => Promise<Envelope<unknown>>;

async function comServidor(
  fn: (call: Chamada, dir: string, pasta: string, arquivo: string) => Promise<void>
): Promise<void> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-cmd-')));
  const pasta = path.join(dir, 'projeto');
  fs.mkdirSync(pasta);
  const arquivo = path.join(dir, 'commands.json');
  const estado = new EstadoStore(path.join(dir, 'state.json'));

  const app = express();
  app.use(express.json());
  app.use('/api/commands', createComandosRouter(new ComandosStore(arquivo), estado));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const call: Chamada = async (method, rota, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/commands${rota}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as Envelope<unknown>;
  };

  // A pasta aberta é o que decide os descobertos.
  estado.abrir(pasta);

  try {
    await fn(call, dir, pasta, arquivo);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('sem manifesto, não há descobertos — e isso não é erro', async () => {
  await comServidor(async (call) => {
    const r = (await call('GET', '/')).data as Listagem;
    assert.deepEqual(r.descobertos, []);
    assert.deepEqual(r.salvos, []);
  });
});

test('os dois manifestos são lidos, com o prefixo de cada um', async () => {
  await comServidor(async (call, _dir, pasta) => {
    fs.writeFileSync(
      path.join(pasta, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc' } })
    );
    fs.writeFileSync(
      path.join(pasta, 'composer.json'),
      JSON.stringify({ scripts: { 'test-unit': 'phpunit' } })
    );

    const r = (await call('GET', '/')).data as Listagem;
    assert.deepEqual(
      r.descobertos.map((c) => c.comando).sort(),
      ['composer run test-unit', 'npm run build']
    );
  });
});

test('manifesto quebrado não derruba a listagem', async () => {
  await comServidor(async (call, _dir, pasta) => {
    fs.writeFileSync(path.join(pasta, 'package.json'), '{ quebrado,,,');
    fs.writeFileSync(path.join(pasta, 'composer.json'), JSON.stringify({ scripts: { ok: 'x' } }));

    const r = (await call('GET', '/')).data as Listagem;
    assert.deepEqual(r.descobertos.map((c) => c.nome), ['ok']);
  });
});

test('salvar e listar', async () => {
  await comServidor(async (call) => {
    const criado = await call('POST', '/', { nome: 'deploy', comando: './deploy.sh', destino: 'shell' });
    assert.equal(criado.success, true);

    const r = (await call('GET', '/')).data as Listagem;
    assert.deepEqual(r.salvos.map((c) => c.nome), ['deploy']);
  });
});

test('nome repetido é recusado', async () => {
  await comServidor(async (call) => {
    await call('POST', '/', { nome: 'deploy', comando: 'a', destino: 'shell' });
    const r = await call('POST', '/', { nome: 'DEPLOY', comando: 'b', destino: 'shell' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /Já existe/);
  });
});

test('destino inválido é recusado', async () => {
  await comServidor(async (call) => {
    const r = await call('POST', '/', { nome: 'x', comando: 'y', destino: 'email' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /shell/);
  });
});

test('destino "sql" de um commands.json antigo é RECUSADO, não convertido', async () => {
  // O destino `sql` saiu na spec 039 (decisão D3). Aceitá-lo como shell seria o
  // pior desfecho possível: um `DELETE FROM alunos` que antes só ABRIA numa aba
  // passaria a ser EXECUTADO num terminal. Recusar perde um comando; converter
  // perde uma tabela.
  await comServidor(async (call) => {
    const r = await call('POST', '/', {
      nome: 'limpeza',
      comando: 'DELETE FROM alunos',
      destino: 'sql',
    });
    assert.equal(r.success, false);
    const lista = (await call('GET', '/')).data as { salvos: unknown[] };
    assert.equal(lista.salvos.length, 0, 'e não entrou na lista por outro caminho');
  });
});

test('remover tira da lista; remover de novo diz que não havia', async () => {
  await comServidor(async (call) => {
    const criado = (await call('POST', '/', { nome: 'a', comando: 'b', destino: 'shell' }))
      .data as { id: string };

    const r1 = (await call('DELETE', `/${criado.id}`)).data as { removido: boolean };
    assert.equal(r1.removido, true);

    const r2 = (await call('DELETE', `/${criado.id}`)).data as { removido: boolean };
    assert.equal(r2.removido, false, 'clicar duas vezes não é erro');
  });
});

test('o comando salvo sobrevive a trocar de pasta — ele é global', async () => {
  await comServidor(async (call, dir, _pasta, arquivo) => {
    await call('POST', '/', { nome: 'global', comando: 'echo oi', destino: 'shell' });

    // Outra pasta, outro estado: o arquivo de comandos é o mesmo.
    const outroEstado = new EstadoStore(path.join(dir, 'state2.json'));
    outroEstado.abrir(dir);
    assert.deepEqual(
      new ComandosStore(arquivo).ler().map((c) => c.nome),
      ['global']
    );
  });
});

test('o arquivo de comandos é 600', async () => {
  await comServidor(async (call, _dir, _pasta, arquivo) => {
    await call('POST', '/', { nome: 'a', comando: 'b', destino: 'shell' });
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
  });
});
