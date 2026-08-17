import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TerminalSession } from '../terminal/session';
import type { ComandoDeTerminal } from '../../shared/terminal/comando';

const SEM_CREDENCIAL: ComandoDeTerminal = {
  exec: '/bin/sh',
  args: [],
  env: {},
  credencial: null,
};

/** Junta a saída até um trecho aparecer, ou desiste. */
function esperarSaida(sessao: TerminalSession, alvo: RegExp, ms = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let tudo = '';
    const prazo = setTimeout(() => reject(new Error(`não veio "${alvo}". Saída: ${tudo}`)), ms);
    sessao.onData((d) => {
      tudo += d;
      if (alvo.test(tudo)) {
        clearTimeout(prazo);
        resolve(tudo);
      }
    });
  });
}

function esperarFim(sessao: TerminalSession, ms = 5_000): Promise<{ exitCode: number; signal?: number }> {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error('o processo não encerrou')), ms);
    sessao.onExit((fim) => {
      clearTimeout(prazo);
      resolve(fim);
    });
  });
}

// ---- é um terminal de verdade (AC-2) ----

test('a sessão roda sob um terminal, e não sob um cano', async () => {
  // `tty` responde o caminho do terminal, ou "not a tty". É a diferença que faz
  // cores, edição de linha e Ctrl+C existirem.
  const sessao = new TerminalSession({
    comando: { ...SEM_CREDENCIAL, args: ['-c', 'tty'] },
  });
  const saida = await esperarSaida(sessao, /dev\/pts|not a tty/);
  sessao.close();

  assert.match(saida, /\/dev\/pts\/\d+/, 'deveria ser um pts de verdade');
});

test('o tamanho pedido chega ao processo', async () => {
  const sessao = new TerminalSession({
    // Espera por um marcador no FIM, e não pelo valor afirmado: parar no
    // primeiro casamento resolveria antes de o resto da saída chegar.
    comando: { ...SEM_CREDENCIAL, args: ['-c', 'tput cols; tput lines; echo FIM'] },
    cols: 133,
    rows: 42,
  });
  const saida = await esperarSaida(sessao, /FIM/);
  sessao.close();

  assert.match(saida, /133/);
  assert.match(saida, /42/);
});

// ---- redimensionamento (AC-4) ----

test('redimensionar muda o que o processo enxerga', async () => {
  const sessao = new TerminalSession({
    // Espera o sinal de mudança de janela e reporta a largura nova.
    comando: {
      ...SEM_CREDENCIAL,
      args: ['-c', 'trap "tput cols" WINCH; sleep 3'],
    },
    cols: 80,
    rows: 24,
  });

  await new Promise((r) => setTimeout(r, 400));
  sessao.resize(150, 50);

  const saida = await esperarSaida(sessao, /150/);
  sessao.close();
  assert.match(saida, /150/);
});

test('tamanho zero ou quebrado não derruba a sessão', () => {
  const sessao = new TerminalSession({ comando: { ...SEM_CREDENCIAL, args: ['-c', 'sleep 2'] } });
  assert.doesNotThrow(() => sessao.resize(0, 0));
  assert.doesNotThrow(() => sessao.resize(-5, 10.7));
  sessao.close();
});

// ---- sinais (AC-3) ----

test('Ctrl+C interrompe o programa em primeiro plano', async () => {
  const sessao = new TerminalSession({
    comando: { ...SEM_CREDENCIAL, args: ['-c', 'sleep 30'] },
  });
  await new Promise((r) => setTimeout(r, 400));

  // `0x03` é o byte que o terminal traduz em SIGINT. Num cano seria só um
  // caractere estranho, e o `sleep` continuaria.
  sessao.write('\x03');

  const fim = await esperarFim(sessao);
  assert.ok(fim.exitCode !== 0 || fim.signal !== undefined, 'o sleep deveria ter sido interrompido');
});

// ---- encerramento (AC-5, AC-6) ----

test('o código de saída chega a quem escuta', async () => {
  const sessao = new TerminalSession({ comando: { ...SEM_CREDENCIAL, args: ['-c', 'exit 7'] } });
  const fim = await esperarFim(sessao);
  assert.equal(fim.exitCode, 7);
});

test('fechar mata o processo', async () => {
  const sessao = new TerminalSession({ comando: { ...SEM_CREDENCIAL, args: ['-c', 'sleep 30'] } });
  const pid = sessao.pid;
  await new Promise((r) => setTimeout(r, 300));

  sessao.close();
  await esperarFim(sessao);

  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'o processo deveria ter morrido');
});

// ---- credencial (AC-10) ----

test('o arquivo de credencial é 600, em diretório 700', async () => {
  const anterior = process.env.DEV_IDE_HOME;
  process.env.DEV_IDE_HOME = fs.mkdtempSync(`${os.tmpdir()}/dev-ide-term-`);
  try {
    const sessao = new TerminalSession({
      comando: { ...SEM_CREDENCIAL, args: ['-c', 'sleep 2'], credencial: 'senha-secreta\n' },
    });

    const dir = `${process.env.DEV_IDE_HOME}/terminal`;
    const [nome] = fs.readdirSync(dir);
    assert.ok(nome !== undefined, 'o arquivo deveria existir enquanto a sessão vive');
    assert.equal(fs.statSync(`${dir}/${nome}`).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);

    sessao.close();
    await esperarFim(sessao);
    assert.deepEqual(fs.readdirSync(dir), [], 'o arquivo deveria sumir ao encerrar');
  } finally {
    if (anterior === undefined) delete process.env.DEV_IDE_HOME;
    else process.env.DEV_IDE_HOME = anterior;
  }
});

test('o arquivo some também quando o processo morre sozinho', async () => {
  const anterior = process.env.DEV_IDE_HOME;
  process.env.DEV_IDE_HOME = fs.mkdtempSync(`${os.tmpdir()}/dev-ide-term-`);
  try {
    // Ninguém chama `close()`: o processo termina por conta própria.
    const sessao = new TerminalSession({
      comando: { ...SEM_CREDENCIAL, args: ['-c', 'exit 0'], credencial: 'nao-pode-ficar\n' },
    });
    await esperarFim(sessao);

    const dir = `${process.env.DEV_IDE_HOME}/terminal`;
    assert.deepEqual(fs.readdirSync(dir), [], 'segredo esquecido em disco');
  } finally {
    if (anterior === undefined) delete process.env.DEV_IDE_HOME;
    else process.env.DEV_IDE_HOME = anterior;
  }
});

// ---- cliente ausente (AC-12) ----

test('executável inexistente vira mensagem, e não deixa o segredo em disco', () => {
  const anterior = process.env.DEV_IDE_HOME;
  process.env.DEV_IDE_HOME = fs.mkdtempSync(`${os.tmpdir()}/dev-ide-term-`);
  try {
    assert.throws(
      () =>
        new TerminalSession({
          comando: {
            exec: 'nao-existe-este-cliente',
            args: [],
            env: {},
            credencial: 'segredo\n',
          },
        }),
      /não está instalado/
    );

    // A checagem acontece ANTES de escrever, então o diretório sequer nasce —
    // melhor que nascer vazio. A afirmação é "nada de segredo em disco".
    const dir = `${process.env.DEV_IDE_HOME}/terminal`;
    const emDisco = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepEqual(emDisco, [], 'o segredo ficou em disco sem processo para apagá-lo');
  } finally {
    if (anterior === undefined) delete process.env.DEV_IDE_HOME;
    else process.env.DEV_IDE_HOME = anterior;
  }
});
