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
    // `pid` é nulo em canal remoto (spec 054) — ali o processo é da outra
    // máquina. Neste teste todos são PTY local, então todos têm número.
    assert.notEqual(pid, null);
    if (pid === null) continue;
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
    // Nenhum teste daqui abre canal de conexão — só PTY local (spec 054).
    abrirCanalDaConexao: () => Promise.reject(new Error('não usado neste teste')),
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

test('fechar o terminal DE PROPÓSITO encerra o processo na hora', async () => {
  await comServidor(async (base, reg) => {
    const ws = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ tipo: 'abrir', opcoes: {} }));
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(reg.quantidade, 1);

    // A mensagem explícita é o que distingue "fechei" de "a página caiu".
    // Sem ela, fechar a aba deixaria o `mysql` vivo com a credencial em disco.
    ws.send(JSON.stringify({ tipo: 'fechar' }));
    await new Promise((r) => setTimeout(r, 600));

    assert.equal(reg.quantidade, 0, 'o processo sobreviveu ao fechamento da aba');
    assert.equal(reg.esperandoReconexao, 0, 'fechar não pode virar espera');
  });
});

test('o socket cair sozinho NÃO mata — é o F5 (spec 023)', async () => {
  await comServidor(async (base, reg) => {
    const ws = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ tipo: 'abrir', opcoes: {} }));
    await new Promise((r) => setTimeout(r, 500));

    // Sem `fechar` antes: é exatamente o que acontece ao recarregar a página,
    // porque o navegador não roda a limpeza do componente.
    ws.close();
    await new Promise((r) => setTimeout(r, 600));

    assert.equal(reg.quantidade, 1, 'a sessão precisa esperar o navegador voltar');
    assert.equal(reg.esperandoReconexao, 1);
  });
});

test('reconectar com o mesmo id reata a sessão e repinta a tela', async () => {
  await comServidor(async (base, reg) => {
    const primeiro = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => primeiro.on('open', r));
    primeiro.send(JSON.stringify({ tipo: 'abrir', id: 'term-fixo', opcoes: {} }));
    await new Promise((r) => setTimeout(r, 500));
    const sessao = reg.obter('term-fixo');
    assert.notEqual(sessao, null, 'o id do cliente foi aceito');

    primeiro.close();
    await new Promise((r) => setTimeout(r, 300));

    const segundo = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => segundo.on('open', r));
    const recebidas: { tipo: string; dados?: string }[] = [];
    segundo.on('message', (b) => recebidas.push(JSON.parse(String(b))));
    segundo.send(JSON.stringify({ tipo: 'abrir', id: 'term-fixo', opcoes: {} }));
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(reg.obter('term-fixo'), sessao, 'é a MESMA sessão, não uma nova');
    assert.ok(
      recebidas.some((m) => m.tipo === 'reconectado'),
      'o cliente precisa saber que reatou, para limpar a tela antes do histórico'
    );
    segundo.send(JSON.stringify({ tipo: 'fechar' }));
  });
});

test('id do cliente fora do formato é ignorado, e vira sessão nova', async () => {
  await comServidor(async (base, reg) => {
    const ws = new WebSocket(base, { headers: { Origin: 'http://localhost:4321' } });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ tipo: 'abrir', id: '../../etc/passwd', opcoes: {} }));
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(reg.quantidade, 1);
    assert.equal(reg.obter('../../etc/passwd'), null, 'o id torto não pode virar chave');
    ws.send(JSON.stringify({ tipo: 'fechar' }));
  });
});

test('erro na abertura vira mensagem, e não silêncio', async () => {
  const reg = new TerminalRegistry();
  const server = http.createServer((_req, res) => res.end('ok'));
  montarSocketDeTerminal(server, {
    registry: reg,
    // Nenhum teste daqui abre canal de conexão — só PTY local (spec 054).
    abrirCanalDaConexao: () => Promise.reject(new Error('não usado neste teste')),
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

// ---------------------------------------------------------------------------
// Reconexão depois do F5 (spec 023)
// ---------------------------------------------------------------------------

/** Um shell que escreve algo e fica vivo — dá histórico e sobrevive ao teste. */
const opcoesDeEco = () => ({
  comando: { ...SH, args: ['-c', 'echo pronto; sleep 5'] },
});

test('o registro solta a sessão em vez de matá-la, e reatar a devolve', () => {
  const registry = new TerminalRegistry(4, 10_000);
  const sessao = registry.abrir('term-a', opcoesDeEco());
  try {
    registry.soltar('term-a');
    assert.equal(registry.quantidade, 1, 'soltar NÃO mata');
    assert.equal(registry.esperandoReconexao, 1);

    assert.equal(registry.reatar('term-a'), sessao, 'a mesma sessão volta');
    assert.equal(registry.esperandoReconexao, 0, 'reatar cancela o prazo');
  } finally {
    registry.fecharTodos();
  }
});

test('sem ninguém reatar, o prazo encerra a sessão', async () => {
  // Prazo curtíssimo: o que se afirma é a regra, não a duração.
  const registry = new TerminalRegistry(4, 30);
  registry.abrir('term-b', opcoesDeEco());
  registry.soltar('term-b');

  await new Promise((r) => setTimeout(r, 200));
  assert.equal(registry.quantidade, 0, 'senão sobraria um bash órfão para sempre');
  assert.equal(registry.esperandoReconexao, 0);
});

test('fechar cancela o prazo e mata na hora', () => {
  const registry = new TerminalRegistry(4, 10_000);
  registry.abrir('term-c', opcoesDeEco());
  registry.soltar('term-c');
  registry.fechar('term-c');

  assert.equal(registry.quantidade, 0);
  assert.equal(registry.esperandoReconexao, 0);
  assert.equal(registry.reatar('term-c'), null);
});

test('reatar o que não existe devolve null, para quem chamou abrir uma nova', () => {
  const registry = new TerminalRegistry();
  assert.equal(registry.reatar('term-inexistente'), null);
});

test('a sessão guarda a saída recente para repintar a tela', async () => {
  const registry = new TerminalRegistry(4, 10_000);
  const sessao = registry.abrir('term-d', opcoesDeEco());
  try {
    await new Promise((r) => setTimeout(r, 400));
    // O `echo` do fixture já escreveu algo; o histórico não pode estar vazio,
    // senão reconectar daria terminal vivo com tela em branco.
    assert.ok(sessao.historico().length > 0);
  } finally {
    registry.fecharTodos();
  }
});

test('soltar desliga o ouvinte — os bytes não vão para um socket fechado', async () => {
  const registry = new TerminalRegistry(4, 10_000);
  const sessao = registry.abrir('term-e', opcoesDeEco());
  try {
    let recebeu = 0;
    sessao.onData(() => { recebeu += 1; });
    registry.soltar('term-e');

    const antes = recebeu;
    sessao.write('mais texto\r');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(recebeu, antes, 'o ouvinte antigo não pode continuar recebendo');
    // Mas o histórico continua crescendo, para a reconexão ter o que mostrar.
    assert.ok(sessao.historico().length > 0);
  } finally {
    registry.fecharTodos();
  }
});
