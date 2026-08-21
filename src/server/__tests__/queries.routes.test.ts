import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { errorEnvelope } from '../http/handlers';
import { createQueriesRouter } from '../routes/queries';
import { VinculosStore } from '../vinculos';
import { raizDeQueries } from '../queries';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

type Chamada = (metodo: string, rota: string, body?: unknown) => Promise<Envelope<unknown>>;

const VINCULO = { connectionId: 'con-1', database: 'servidor-2' };

async function comServidor(
  fn: (call: Chamada, raiz: string, vinculos: VinculosStore) => Promise<void>,
  idsDeConexao: readonly string[] = ['con-1']
): Promise<void> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-queries-')));
  const anterior = process.env.DEV_IDE_HOME;
  process.env.DEV_IDE_HOME = dir;

  const vinculos = new VinculosStore(path.join(dir, 'queries.json'));
  const app = express();
  app.use(express.json());
  app.use('/api/queries', createQueriesRouter({ vinculos, idsDeConexao: () => idsDeConexao }));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const call: Chamada = async (metodo, rota, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/queries${rota}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await r.json()) as Envelope<unknown>;
  };

  try {
    await fn(call, raizDeQueries(), vinculos);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (anterior === undefined) delete process.env.DEV_IDE_HOME;
    else process.env.DEV_IDE_HOME = anterior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const qs = (v = VINCULO): string =>
  `?connectionId=${encodeURIComponent(v.connectionId)}&database=${encodeURIComponent(v.database)}`;

// ---------------------------------------------------------------------------
// Abrir
// ---------------------------------------------------------------------------

test('abrir query cria o arquivo com o nome do database', async () => {
  await comServidor(async (call) => {
    const r = await call('POST', '/open', VINCULO);
    const caminho = (r.data as { caminho: string }).caminho;
    assert.equal(path.basename(caminho), 'servidor-2.sql');
    assert.equal(fs.readFileSync(caminho, 'utf8'), '', 'nasce em branco');
  });
});

test('abrir query duas vezes não apaga o que já estava lá', async () => {
  await comServidor(async (call) => {
    const caminho = ((await call('POST', '/open', VINCULO)).data as { caminho: string }).caminho;
    fs.writeFileSync(caminho, 'SELECT 1;');
    await call('POST', '/open', VINCULO);
    assert.equal(fs.readFileSync(caminho, 'utf8'), 'SELECT 1;');
  });
});

test('a pasta leva conexão e database, e o arquivo nasce 600', async () => {
  await comServidor(async (call, raiz) => {
    const caminho = ((await call('POST', '/open', VINCULO)).data as { caminho: string }).caminho;
    assert.equal(path.dirname(caminho), path.join(raiz, 'con-1@servidor-2'));
    assert.equal(fs.statSync(caminho).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(caminho)).mode & 0o777, 0o700);
  });
});

// ---------------------------------------------------------------------------
// Listar, criar, renomear, apagar
// ---------------------------------------------------------------------------

test('pasta que ainda não existe lista vazio, sem erro', async () => {
  await comServidor(async (call) => {
    const r = await call('GET', `/${qs()}`);
    assert.equal(r.success, true);
    assert.deepEqual(r.data, []);
  });
});

test('cria, lista em ordem, renomeia e apaga', async () => {
  await comServidor(async (call) => {
    await call('POST', '/', { ...VINCULO, nome: 'zebra' });
    await call('POST', '/', { ...VINCULO, nome: 'abacaxi.sql' });

    let nomes = ((await call('GET', `/${qs()}`)).data as { nome: string }[]).map((a) => a.nome);
    assert.deepEqual(nomes, ['abacaxi.sql', 'zebra.sql'], 'extensão posta e ordem alfabética');

    await call('POST', '/rename', { ...VINCULO, de: 'zebra.sql', para: 'jaca' });
    nomes = ((await call('GET', `/${qs()}`)).data as { nome: string }[]).map((a) => a.nome);
    assert.deepEqual(nomes, ['abacaxi.sql', 'jaca.sql']);

    await call('DELETE', '/', { ...VINCULO, nome: 'jaca.sql' });
    nomes = ((await call('GET', `/${qs()}`)).data as { nome: string }[]).map((a) => a.nome);
    assert.deepEqual(nomes, ['abacaxi.sql']);
  });
});

test('duas conexões não veem os arquivos uma da outra', async () => {
  await comServidor(async (call) => {
    await call('POST', '/', { ...VINCULO, nome: 'minha' });
    const outra = { connectionId: 'con-2', database: 'servidor-2' };
    const r = await call('GET', `/${qs(outra)}`);
    assert.deepEqual(r.data, []);
  });
});

test('o mesmo servidor com databases diferentes também separa', async () => {
  await comServidor(async (call) => {
    await call('POST', '/', { ...VINCULO, nome: 'minha' });
    const outro = { connectionId: 'con-1', database: 'outro' };
    assert.deepEqual((await call('GET', `/${qs(outro)}`)).data, []);
  });
});

// ---------------------------------------------------------------------------
// A cerca (AC-3, AC-26)
// ---------------------------------------------------------------------------

test('nome com .. é recusado, e nada é criado fora da raiz', async () => {
  await comServidor(async (call, raiz) => {
    const r = await call('POST', '/', { ...VINCULO, nome: '../../fuga' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /separador de caminho|ponto/);
    assert.equal(fs.existsSync(path.join(path.dirname(raiz), 'fuga.sql')), false);
  });
});

test('nome com barra é recusado', async () => {
  await comServidor(async (call) => {
    const r = await call('POST', '/', { ...VINCULO, nome: 'sub/x' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /separador de caminho/);
  });
});

test('nome vazio, só espaço ou começando com ponto é recusado', async () => {
  await comServidor(async (call) => {
    for (const nome of ['', '   ', '.escondido', '.', '..']) {
      const r = await call('POST', '/', { ...VINCULO, nome });
      assert.equal(r.success, false, `aceitou "${nome}"`);
    }
  });
});

test('nome repetido é recusado, e o arquivo de antes não é tocado', async () => {
  await comServidor(async (call) => {
    const caminho = ((await call('POST', '/', { ...VINCULO, nome: 'x' })).data as { caminho: string }).caminho;
    fs.writeFileSync(caminho, 'SELECT 1;');
    const r = await call('POST', '/', { ...VINCULO, nome: 'x' });
    assert.equal(r.success, false);
    assert.equal(fs.readFileSync(caminho, 'utf8'), 'SELECT 1;');
  });
});

test('renomear para nome já usado é recusado', async () => {
  await comServidor(async (call) => {
    await call('POST', '/', { ...VINCULO, nome: 'a' });
    await call('POST', '/', { ...VINCULO, nome: 'b' });
    const r = await call('POST', '/rename', { ...VINCULO, de: 'a.sql', para: 'b' });
    assert.equal(r.success, false);
  });
});

test('vínculo sem conexão ou sem database é recusado', async () => {
  await comServidor(async (call) => {
    assert.equal((await call('POST', '/open', { database: 'g' })).success, false);
    assert.equal((await call('POST', '/open', { connectionId: 'c' })).success, false);
  });
});

test('database com barra no nome vira uma pasta só, e um arquivo só', async () => {
  // O MySQL aceita `a/b` como nome de database entre crases. A pasta é
  // codificada, e o nome do arquivo padrão é saneado — ver
  // `nomePadraoDoDatabase`. Sem isso, `Abrir Query` falhava nesses bancos.
  await comServidor(async (call, raiz) => {
    const estranho = { connectionId: 'con-1', database: 'a/b' };
    const r = await call('POST', '/open', estranho);
    assert.equal(r.success, true, r.error ?? '');
    const caminho = (r.data as { caminho: string }).caminho;
    assert.equal(path.basename(caminho), 'a_b.sql');
    assert.equal(path.dirname(path.dirname(caminho)), raiz, 'não criou nível a mais');
    assert.equal(fs.existsSync(caminho), true);
  });
});

test('database que vira nome vazio ainda tem arquivo', async () => {
  await comServidor(async (call) => {
    const r = await call('POST', '/open', { connectionId: 'con-1', database: '...' });
    assert.equal(r.success, true, r.error ?? '');
    assert.equal(path.basename((r.data as { caminho: string }).caminho), 'query.sql');
  });
});

// ---------------------------------------------------------------------------
// O vínculo lembrado
// ---------------------------------------------------------------------------

test('lembra o vínculo de um arquivo e devolve depois', async () => {
  await comServidor(async (call, raiz) => {
    await call('POST', '/links', { caminho: '/projeto/x.sql', ...VINCULO });
    const r = (await call('GET', '/links')).data as {
      raiz: string;
      links: Record<string, unknown>;
    };
    assert.deepEqual(r.links['/projeto/x.sql'], VINCULO);
    assert.equal(r.raiz, raiz, 'a raiz vem junto, para a interface derivar do caminho');
  });
});

test('esquecer tira da lista', async () => {
  await comServidor(async (call) => {
    await call('POST', '/links', { caminho: '/projeto/x.sql', ...VINCULO });
    await call('DELETE', '/links', { caminho: '/projeto/x.sql' });
    assert.deepEqual(((await call('GET', '/links')).data as { links: unknown }).links, {});
  });
});

test('lembrança de conexão que sumiu é descartada ao listar', async () => {
  // AC-11: apagar uma conexão não pode deixar arquivos amarrados a um fantasma.
  await comServidor(async (call) => {
    await call('POST', '/links', { caminho: '/projeto/x.sql', ...VINCULO });
    assert.deepEqual(((await call('GET', '/links')).data as { links: unknown }).links, {});
  }, [] /* nenhuma conexão viva */);
});

test('o vínculo NÃO é gravado dentro do arquivo', async () => {
  // AC-7, e é a decisão D11: nada de `-- Active:` sujando arquivo do projeto.
  await comServidor(async (call) => {
    const caminho = ((await call('POST', '/open', VINCULO)).data as { caminho: string }).caminho;
    fs.writeFileSync(caminho, 'SELECT 1;\n');
    await call('POST', '/links', { caminho, ...VINCULO });
    assert.equal(fs.readFileSync(caminho, 'utf8'), 'SELECT 1;\n');
  });
});
