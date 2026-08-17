import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { TerminalRegistry } from '../terminal/registry';
import { CAMINHO_DO_SOCKET, montarSocketDeTerminal } from '../terminal/socket';
import type { ComandoDeTerminal } from '../../shared/terminal/comando';

const SH: ComandoDeTerminal = { exec: '/bin/sh', args: [], env: {}, credencial: null };

// ---- registro (AC-17) ----

test('o limite de terminais recusa o excedente com mensagem', () => {
  const reg = new TerminalRegistry(2);
  const opcoes = { comando: { ...SH, args: ['-c', 'sleep 5'] } };

  reg.abrir('a', opcoes);
  reg.abrir('b', opcoes);
  assert.throws(() => reg.abrir('c', opcoes), /Limite de 2 terminais/);

  reg.fecharTodos();
});

test('id repetido é recusado', () => {
  const reg = new TerminalRegistry();
  reg.abrir('mesmo', { comando: { ...SH, args: ['-c', 'sleep 5'] } });
  assert.throws(() => reg.abrir('mesmo', { comando: SH }), /Já existe um terminal/);
  reg.fecharTodos();
});

test('a sessão sai do registro sozinha ao morrer', async () => {
  const reg = new TerminalRegistry();
  const sessao = reg.abrir('curta', { comando: { ...SH, args: ['-c', 'exit 0'] } });

  await new Promise<void>((r) => sessao.onExit(() => r()));
  // Um `setImmediate` para o ouvinte do registro rodar.
  await new Promise((r) => setImmediate(r));

  assert.equal(reg.quantidade, 0, 'sessão morta continuou ocupando vaga');
  assert.equal(reg.obter('curta'), null);
});

// ---- encerramento em massa (AC-16) ----

test('fecharTodos não deixa processo vivo', async () => {
  const reg = new TerminalRegistry();
  const pids = ['x', 'y', 'z'].map(
    (id) => reg.abrir(id, { comando: { ...SH, args: ['-c', 'sleep 30'] } }).pid
  );
  await new Promise((r) => setTimeout(r, 300));

  reg.fecharTodos();
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(reg.quantidade, 0);
  for (const pid of pids) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/, `processo ${pid} sobreviveu`);
  }
});

// ---- guarda de origem (AC-15) ----

async function comServidor(
  fn: (base: string, reg: TerminalRegistry) => Promise<void>
): Promise<void> {
  const reg = new TerminalRegistry();
  const server = http.createServer((_req, res) => res.end('ok'));
  montarSocketDeTerminal(server, {
    registry: reg,
    resolverAbertura: async () => ({ comando: { ...SH, args: ['-c', 'echo PRONTO; sleep 5'] } }),
  });

  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;

  try {
    await fn(`ws://127.0.0.1:${port}${CAMINHO_DO_SOCKET}`, reg);
  } finally {
    reg.fecharTodos();
    await new Promise((r) => server.close(r));
  }
}

test('recusa o upgrade quando a origem não é local', async () => {
  await comServidor(async (base, reg) => {
    const ws = new WebSocket(base, { headers: { Origin: 'https://sitemalicioso.example' } });
    const erro = await new Promise<Error>((resolve) => {
      ws.on('error', resolve);
      ws.on('open', () => resolve(new Error('ABRIU, e não deveria')));
    });

    assert.match(erro.message, /403|Unexpected server response/i);
    // O ponto que mais importa: nenhum processo nasceu.
    assert.equal(reg.quantidade, 0, 'um PTY foi criado apesar da origem recusada');
  });
});

test('aceita a origem local e entrega a saída do processo', async () => {
  await comServidor(async (base) => {
    const ws = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => ws.on('open', r));

    ws.send(JSON.stringify({ tipo: 'abrir', opcoes: {} }));

    const saida = await new Promise<string>((resolve, reject) => {
      let tudo = '';
      const prazo = setTimeout(() => reject(new Error(`sem saída: ${tudo}`)), 5_000);
      ws.on('message', (bruto) => {
        const msg = JSON.parse(String(bruto)) as { tipo: string; dados?: string };
        if (msg.tipo === 'dados') tudo += msg.dados ?? '';
        if (/PRONTO/.test(tudo)) {
          clearTimeout(prazo);
          resolve(tudo);
        }
      });
    });

    assert.match(saida, /PRONTO/);
    ws.close();
  });
});

test('fechar o socket encerra o processo', async () => {
  await comServidor(async (base, reg) => {
    const ws = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ tipo: 'abrir', opcoes: {} }));
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(reg.quantidade, 1);

    ws.close();
    await new Promise((r) => setTimeout(r, 600));

    // Sem isto, fechar a aba deixaria o `mysql` vivo com a credencial em disco.
    assert.equal(reg.quantidade, 0, 'o processo sobreviveu ao fechamento da aba');
  });
});

test('erro na abertura vira mensagem, e não silêncio', async () => {
  const reg = new TerminalRegistry();
  const server = http.createServer((_req, res) => res.end('ok'));
  montarSocketDeTerminal(server, {
    registry: reg,
    resolverAbertura: async () => ({ comando: { ...SH, exec: 'nao-existe-mesmo' } }),
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${CAMINHO_DO_SOCKET}`, {
      headers: { Origin: 'http://localhost:4321' },
    });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ tipo: 'abrir', opcoes: {} }));

    const msg = await new Promise<{ tipo: string; mensagem?: string }>((resolve) => {
      ws.on('message', (bruto) => resolve(JSON.parse(String(bruto))));
    });

    assert.equal(msg.tipo, 'erro');
    assert.match(msg.mensagem ?? '', /não está instalado/);
  } finally {
    reg.fecharTodos();
    await new Promise((r) => server.close(r));
  }
});

test('mensagem inválida não derruba a conexão', async () => {
  await comServidor(async (base) => {
    const ws = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => ws.on('open', r));

    ws.send('isto não é json');
    const msg = await new Promise<{ tipo: string }>((resolve) => {
      ws.on('message', (bruto) => resolve(JSON.parse(String(bruto))));
    });

    assert.equal(msg.tipo, 'erro');
    assert.equal(ws.readyState, ws.OPEN, 'a conexão caiu por causa de lixo na entrada');
    ws.close();
  });
});
