import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionPool } from '../connections/pool';
import type { Session } from '../connections/types';

interface SessionFake extends Session {
  readonly closed: () => boolean;
}

function sessionFake(): SessionFake {
  let fechada = false;
  return {
    kind: 'sql',
    children: async () => [],
    close: async () => {
      fechada = true;
    },
    closed: () => fechada,
  };
}

/** Relógio controlado, para testar ociosidade sem depender de timer real. */
function relogio(inicio = 0) {
  let agora = inicio;
  return { now: () => agora, avancar: (ms: number) => (agora += ms) };
}

test('abre uma vez e reaproveita a sessão', async () => {
  let aberturas = 0;
  const pool = new SessionPool(async () => {
    aberturas += 1;
    return sessionFake();
  });

  const a = await pool.acquire('conn-1');
  const b = await pool.acquire('conn-1');
  assert.equal(aberturas, 1);
  assert.equal(a, b);
  assert.deepEqual(pool.openIds(), ['conn-1']);
});

test('chamadas concorrentes não abrem duas sessões', async () => {
  let aberturas = 0;
  const pool = new SessionPool(async () => {
    aberturas += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return sessionFake();
  });

  const [a, b, c] = await Promise.all([
    pool.acquire('conn-1'),
    pool.acquire('conn-1'),
    pool.acquire('conn-1'),
  ]);
  assert.equal(aberturas, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test('sessões de conexões diferentes são independentes', async () => {
  const pool = new SessionPool(async () => sessionFake());
  await pool.acquire('conn-1');
  await pool.acquire('conn-2');
  assert.deepEqual(pool.openIds().sort(), ['conn-1', 'conn-2']);
});

test('close fecha a sessão e permite reabrir depois', async () => {
  let aberturas = 0;
  const sessoes: SessionFake[] = [];
  const pool = new SessionPool(async () => {
    aberturas += 1;
    const sessao = sessionFake();
    sessoes.push(sessao);
    return sessao;
  });

  await pool.acquire('conn-1');
  await pool.close('conn-1');
  assert.equal(sessoes[0].closed(), true);
  assert.deepEqual(pool.openIds(), []);

  await pool.acquire('conn-1');
  assert.equal(aberturas, 2);
});

test('uma conexão que falha ao abrir não envenena o pool', async () => {
  let tentativas = 0;
  const pool = new SessionPool(async () => {
    tentativas += 1;
    if (tentativas === 1) throw new Error('servidor fora do ar');
    return sessionFake();
  });

  await assert.rejects(() => pool.acquire('conn-1'), /fora do ar/);
  assert.deepEqual(pool.openIds(), []);

  const sessao = await pool.acquire('conn-1');
  assert.ok(sessao, 'a segunda tentativa deve abrir normalmente');
});

test('sweep fecha sessões ociosas e preserva as recentes', async () => {
  const clock = relogio();
  const sessoes = new Map<string, SessionFake>();
  const pool = new SessionPool(
    async (id) => {
      const sessao = sessionFake();
      sessoes.set(id, sessao);
      return sessao;
    },
    { idleTimeoutMs: 1000, now: clock.now }
  );

  await pool.acquire('velha');
  clock.avancar(900);
  await pool.acquire('nova');
  clock.avancar(200); // velha: 1100ms ociosa; nova: 200ms

  await pool.sweep();

  assert.equal(sessoes.get('velha')!.closed(), true);
  assert.equal(sessoes.get('nova')!.closed(), false);
  assert.deepEqual(pool.openIds(), ['nova']);
});

test('acquire renova a ociosidade', async () => {
  const clock = relogio();
  const pool = new SessionPool(async () => sessionFake(), {
    idleTimeoutMs: 1000,
    now: clock.now,
  });

  await pool.acquire('conn-1');
  clock.avancar(900);
  await pool.acquire('conn-1'); // reusa e renova
  clock.avancar(300);

  await pool.sweep();
  assert.deepEqual(pool.openIds(), ['conn-1']);
});

test('sessão que morre sozinha é despejada, e a próxima abre uma nova', async () => {
  // O servidor de banco fecha conexões ociosas por conta própria (wait_timeout).
  // Se o pool continuar entregando a sessão morta, toda operação seguinte falha
  // até alguém reiniciar a IDE — foi assim que uma queda de conexão derrubou o
  // processo inteiro.
  let aberturas = 0;
  const avisar: Array<(motivo: string) => void> = [];

  const pool = new SessionPool(async () => {
    aberturas += 1;
    return {
      kind: 'sql',
      children: async () => [],
      close: async () => {},
      onClosed: (listener: (motivo: string) => void) => avisar.push(listener),
    };
  });

  await pool.acquire('conn-1');
  assert.deepEqual(pool.openIds(), ['conn-1']);

  // o driver avisa que a conexão subjacente morreu
  avisar[0]('wait_timeout');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pool.openIds(), [], 'a sessão morta precisa sair do pool');

  await pool.acquire('conn-1');
  assert.equal(aberturas, 2, 'a próxima chamada deve abrir uma sessão nova');
});

test('closeAll fecha tudo, mesmo se um close falhar', async () => {
  const boa = sessionFake();
  const pool = new SessionPool(async (id) => {
    if (id === 'ruim') {
      return { kind: 'sql', children: async () => [], close: async () => { throw new Error('falhou'); } };
    }
    return boa;
  });

  await pool.acquire('ruim');
  await pool.acquire('boa');

  await pool.closeAll();
  assert.deepEqual(pool.openIds(), []);
  assert.equal(boa.closed(), true);
});
