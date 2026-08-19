import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { errorEnvelope } from '../http/handlers';
import { EstadoStore } from '../estado';
import { createBuscaRouter } from '../routes/busca';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

interface Resultado {
  readonly arquivos: readonly { caminho: string; ocorrencias: { linha: number }[] }[];
  readonly totalDeOcorrencias: number;
  readonly truncado: boolean;
}

type Chamada = (rota: string, body: unknown) => Promise<Envelope<unknown>>;

async function comServidor(
  fn: (call: Chamada, pasta: string, fora: string) => Promise<void>
): Promise<void> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-busca-')));
  const pasta = path.join(dir, 'projeto');
  fs.mkdirSync(pasta);

  const estado = new EstadoStore(path.join(dir, 'state.json'));
  estado.abrir(pasta);

  const app = express();
  app.use(express.json());
  app.use('/api/search', createBuscaRouter(estado));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const call: Chamada = async (rota, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/search${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await r.json()) as Envelope<unknown>;
  };

  try {
    await fn(call, pasta, dir);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('acha o termo em vários arquivos, com a linha certa', async () => {
  await comServidor(async (call, pasta) => {
    fs.writeFileSync(path.join(pasta, 'a.ts'), 'const alvo = 1;\nnada\nalvo de novo\n');
    fs.writeFileSync(path.join(pasta, 'b.ts'), 'sem nada aqui\n');
    fs.mkdirSync(path.join(pasta, 'sub'));
    fs.writeFileSync(path.join(pasta, 'sub', 'c.ts'), 'outro alvo\n');

    const r = (await call('/', { termo: 'alvo' })).data as Resultado;
    assert.equal(r.totalDeOcorrencias, 3);
    assert.deepEqual(
      r.arquivos.map((a) => path.basename(a.caminho)).sort(),
      ['a.ts', 'c.ts'],
      'arquivo sem ocorrência não entra no resultado'
    );
    assert.deepEqual(
      r.arquivos.find((a) => a.caminho.endsWith('a.ts'))?.ocorrencias.map((o) => o.linha),
      [1, 3]
    );
  });
});

test('termo vazio devolve vazio, e NÃO erro', async () => {
  await comServidor(async (call) => {
    // O campo fica vazio enquanto o usuário apaga o que digitou.
    const r = await call('/', { termo: '   ' });
    assert.equal(r.success, true);
    assert.equal((r.data as Resultado).totalDeOcorrencias, 0);
  });
});

test('regex só vale quando pedida', async () => {
  await comServidor(async (call, pasta) => {
    fs.writeFileSync(path.join(pasta, 'a.txt'), 'axb\na.b\n');

    const literal = (await call('/', { termo: 'a.b' })).data as Resultado;
    assert.equal(literal.totalDeOcorrencias, 1, 'literal não pode casar axb');

    const comRegex = (await call('/', { termo: 'a.b', regex: true })).data as Resultado;
    assert.equal(comRegex.totalDeOcorrencias, 2);
  });
});

test('maiúsculas e palavra inteira chegam ao servidor', async () => {
  await comServidor(async (call, pasta) => {
    fs.writeFileSync(path.join(pasta, 'a.txt'), 'casa\nCASA\ncasamento\n');

    assert.equal(((await call('/', { termo: 'casa' })).data as Resultado).totalDeOcorrencias, 3);
    assert.equal(
      ((await call('/', { termo: 'casa', maiusculas: true })).data as Resultado).totalDeOcorrencias,
      2,
      'CASA sai, casa e casamento ficam'
    );
    assert.equal(
      ((await call('/', { termo: 'casa', palavraInteira: true })).data as Resultado)
        .totalDeOcorrencias,
      2,
      'casamento sai'
    );
  });
});

test('arquivo binário não entra no resultado', async () => {
  await comServidor(async (call, pasta) => {
    fs.writeFileSync(path.join(pasta, 'bin.dat'), Buffer.from([0x61, 0x00, 0x61, 0x6c, 0x76, 0x6f]));
    fs.writeFileSync(path.join(pasta, 'a.txt'), 'alvo\n');

    const r = (await call('/', { termo: 'alvo' })).data as Resultado;
    assert.deepEqual(r.arquivos.map((a) => path.basename(a.caminho)), ['a.txt']);
  });
});

test('buscar sem pasta aberta explica o que fazer', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-busca-sem-')));
  const estado = new EstadoStore(path.join(dir, 'state.json'));
  const app = express();
  app.use(express.json());
  app.use('/api/search', createBuscaRouter(estado));
  app.use(errorEnvelope);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;

  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termo: 'x' }),
    });
    const payload = (await r.json()) as Envelope<unknown>;
    assert.equal(payload.success, false);
    assert.match(payload.error ?? '', /Abra uma pasta/);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Substituir
// ---------------------------------------------------------------------------

test('substitui num arquivo só, deixando os outros intactos', async () => {
  await comServidor(async (call, pasta) => {
    const um = path.join(pasta, 'um.txt');
    const dois = path.join(pasta, 'dois.txt');
    fs.writeFileSync(um, 'alvo aqui\n');
    fs.writeFileSync(dois, 'alvo ali\n');

    const r = (await call('/replace', { termo: 'alvo', substituto: 'X', caminhos: [um] }))
      .data as { arquivosAlterados: number; trocas: number };
    assert.deepEqual(r, { arquivosAlterados: 1, trocas: 1 });
    assert.equal(fs.readFileSync(um, 'utf8'), 'X aqui\n');
    assert.equal(fs.readFileSync(dois, 'utf8'), 'alvo ali\n', 'o outro não podia mudar');
  });
});

test('substitui em todos os indicados de uma vez', async () => {
  await comServidor(async (call, pasta) => {
    const um = path.join(pasta, 'um.txt');
    const dois = path.join(pasta, 'dois.txt');
    fs.writeFileSync(um, 'alvo alvo\n');
    fs.writeFileSync(dois, 'alvo\n');

    const r = (await call('/replace', { termo: 'alvo', substituto: 'X', caminhos: [um, dois] }))
      .data as { arquivosAlterados: number; trocas: number };
    assert.deepEqual(r, { arquivosAlterados: 2, trocas: 3 });
  });
});

test('CAMINHO FORA DA PASTA ABERTA é recusado em silêncio', async () => {
  await comServidor(async (call, pasta, fora) => {
    const dentro = path.join(pasta, 'dentro.txt');
    const externo = path.join(fora, 'externo.txt');
    fs.writeFileSync(dentro, 'alvo\n');
    fs.writeFileSync(externo, 'alvo\n');

    // A lista de caminhos vem do CLIENTE, e substituir reescreve arquivo. Esta
    // é a única checagem entre um erro e um arquivo de fora sendo reescrito.
    await call('/replace', { termo: 'alvo', substituto: 'X', caminhos: [dentro, externo] });
    assert.equal(fs.readFileSync(externo, 'utf8'), 'alvo\n', 'arquivo de fora foi alterado');
    assert.equal(fs.readFileSync(dentro, 'utf8'), 'X\n');
  });
});

test('substituir sem termo ou sem arquivo é recusado', async () => {
  await comServidor(async (call, pasta) => {
    const um = path.join(pasta, 'um.txt');
    fs.writeFileSync(um, 'alvo\n');

    const semTermo = await call('/replace', { termo: '  ', substituto: 'X', caminhos: [um] });
    assert.equal(semTermo.success, false);

    const semArquivo = await call('/replace', { termo: 'alvo', substituto: 'X', caminhos: [] });
    assert.equal(semArquivo.success, false);
    assert.equal(fs.readFileSync(um, 'utf8'), 'alvo\n');
  });
});

test('substituição com grupo funciona em modo regex', async () => {
  await comServidor(async (call, pasta) => {
    const um = path.join(pasta, 'um.txt');
    fs.writeFileSync(um, 'joao@exemplo\n');

    await call('/replace', {
      termo: '(\\w+)@(\\w+)',
      regex: true,
      substituto: '$2/$1',
      caminhos: [um],
    });
    assert.equal(fs.readFileSync(um, 'utf8'), 'exemplo/joao\n');
  });
});

test('em busca literal o cifrão do substituto é texto', async () => {
  await comServidor(async (call, pasta) => {
    const um = path.join(pasta, 'um.txt');
    fs.writeFileSync(um, 'preco: X\n');

    await call('/replace', { termo: 'X', substituto: 'US$1', caminhos: [um] });
    assert.equal(fs.readFileSync(um, 'utf8'), 'preco: US$1\n');
  });
});
