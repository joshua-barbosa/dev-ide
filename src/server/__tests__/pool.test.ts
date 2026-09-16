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

// ---------------------------------------------------------------------------
// Desconectar SEMPRE termina
//
// Ele achou usando, com a conexão de produção: *"travou, nem consigo dar
// desconectar"*. Eram duas travas diferentes, e as duas apareciam do mesmo
// jeito na tela — o botão não fazia nada.
// ---------------------------------------------------------------------------

test('desconectar durante a ABERTURA desiste dela, e não deixa a sessão viva', async () => {
  let liberar: (s: Session) => void = () => undefined;
  const sessao = sessionFake();
  const pool = new SessionPool(
    () => new Promise<Session>((resolver) => { liberar = resolver; })
  );

  // Alguém pediu a conexão, e ela está pendurada abrindo.
  const pedido = pool.acquire('producao');
  const esperado = assert.rejects(() => pedido, /desconectada antes de terminar de abrir/);

  // Antes, isto voltava calado: a sessão não estava no mapa, então não havia o
  // que fechar — e a abertura seguia em voo.
  await pool.close('producao');

  // Agora o servidor responde, tarde. A sessão NÃO pode se registrar.
  liberar(sessao);
  await esperado;
  assert.equal(pool.isOpen('producao'), false, 'não ressuscita depois de desistir');
  assert.equal(sessao.closed(), true, 'e o socket que chegou atrasado é fechado');
});

test('depois de desistir, pedir de novo abre uma conexão NOVA', async () => {
  // Sem isto, a segunda tentativa entraria na fila da abertura morta e ficaria
  // pendurada junto — a conexão nunca mais voltaria sem reiniciar a IDE.
  const presas: ((s: Session) => void)[] = [];
  const pool = new SessionPool(
    () => new Promise<Session>((resolver) => presas.push(resolver))
  );

  void pool.acquire('producao').catch(() => undefined);
  await pool.close('producao');

  const segunda = pool.acquire('producao');
  assert.equal(presas.length, 2, 'a fábrica foi chamada de novo');
  presas[1]?.(sessionFake());
  await segunda;
  assert.equal(pool.isOpen('producao'), true);
});

test('desconectar não espera para sempre por um close travado', async () => {
  // `close()` de um socket morto pode não voltar nunca. A entrada já saiu do
  // mapa, então para a IDE ela está desconectada na hora; o fechamento educado
  // segue de fundo.
  const travada: Session = {
    kind: 'sql',
    children: async () => [],
    close: () => new Promise<void>(() => undefined),
  };
  const pool = new SessionPool(async () => travada, { closeTimeoutMs: 20 });

  await pool.acquire('producao');
  const comecou = Date.now();
  await pool.close('producao');

  assert.ok(Date.now() - comecou < 1_000, 'voltou sem esperar o close travado');
  assert.equal(pool.isOpen('producao'), false);
});

test('close que EXPLODE também desconecta', async () => {
  const explosiva: Session = {
    kind: 'sql',
    children: async () => [],
    close: async () => {
      throw new Error('socket já morreu');
    },
  };
  const pool = new SessionPool(async () => explosiva);
  await pool.acquire('producao');
  await pool.close('producao');
  assert.equal(pool.isOpen('producao'), false);
});

// ---------------------------------------------------------------------------
// Sessão RETIDA: terminal e túnel abertos não contam como ociosidade
// ---------------------------------------------------------------------------
//
// Ele: "os terminais estão encerrando depois de um período considerado idle,
// mas tem casos que eu estou rodando um script que é loop eterno". O relógio
// de uso só andava no `acquire`; o terminal pede a sessão UMA vez, e o que
// passa depois pelo canal não toca nele. Aos 10 minutos o varredor fechava a
// sessão SSH, e o terminal morria junto com o script.

const DEZ_MIN = 10 * 60 * 1000;

test('sessão retida sobrevive à varredura, por mais tempo que passe', async () => {
  const r = relogio();
  const sessao = sessionFake();
  const pool = new SessionPool(async () => sessao, { idleTimeoutMs: DEZ_MIN, now: r.now });

  await pool.acquire('ssh-1');
  pool.reter('ssh-1');
  r.avancar(24 * 60 * 60 * 1000); // um dia inteiro de loop
  await pool.sweep();

  assert.equal(sessao.closed(), false);
  assert.ok(pool.isOpen('ssh-1'));
});

test('soltar a última retenção devolve a sessão à ociosidade normal — contando DAQUI', async () => {
  const r = relogio();
  const sessao = sessionFake();
  const pool = new SessionPool(async () => sessao, { idleTimeoutMs: DEZ_MIN, now: r.now });

  await pool.acquire('ssh-1');
  const soltar = pool.reter('ssh-1');
  r.avancar(3 * DEZ_MIN);
  soltar();

  // Fechar o terminal não pode derrubar a conexão no mesmo instante: o prazo
  // conta a partir de quando ele saiu.
  await pool.sweep();
  assert.equal(sessao.closed(), false, 'fechou logo depois de soltar');

  r.avancar(DEZ_MIN + 1);
  await pool.sweep();
  assert.equal(sessao.closed(), true);
});

test('duas retenções: soltar uma não libera a outra', async () => {
  const r = relogio();
  const sessao = sessionFake();
  const pool = new SessionPool(async () => sessao, { idleTimeoutMs: DEZ_MIN, now: r.now });

  await pool.acquire('ssh-1');
  const terminal1 = pool.reter('ssh-1');
  pool.reter('ssh-1'); // segundo terminal, ou um túnel
  terminal1();
  r.avancar(5 * DEZ_MIN);
  await pool.sweep();

  assert.equal(sessao.closed(), false);
});

test('soltar duas vezes não desconta a retenção de outro', async () => {
  const r = relogio();
  const sessao = sessionFake();
  const pool = new SessionPool(async () => sessao, { idleTimeoutMs: DEZ_MIN, now: r.now });

  await pool.acquire('ssh-1');
  const a = pool.reter('ssh-1');
  pool.reter('ssh-1');
  a();
  a(); // o fechamento do canal pode avisar mais de uma vez
  r.avancar(5 * DEZ_MIN);
  await pool.sweep();

  assert.equal(sessao.closed(), false);
});

test('desconectar de propósito fecha mesmo retida — a retenção é contra a VARREDURA, não contra ele', async () => {
  const sessao = sessionFake();
  const pool = new SessionPool(async () => sessao);

  await pool.acquire('ssh-1');
  pool.reter('ssh-1');
  await pool.close('ssh-1');

  assert.equal(sessao.closed(), true);
  assert.equal(pool.isOpen('ssh-1'), false);
});

test('reter uma conexão que não está aberta não quebra, e soltar depois também não', async () => {
  const pool = new SessionPool(async () => sessionFake());
  const soltar = pool.reter('nao-aberta');
  assert.doesNotThrow(soltar);
});

test('retenção não sobrevive a uma sessão NOVA da mesma conexão', async () => {
  // Reconectou: a retenção era do canal que morreu com a sessão velha. Herdar
  // a contagem deixaria a sessão nova imortal para sempre.
  const r = relogio();
  const sessoes = [sessionFake(), sessionFake()];
  let i = 0;
  const pool = new SessionPool(async () => sessoes[i++]!, { idleTimeoutMs: DEZ_MIN, now: r.now });

  await pool.acquire('ssh-1');
  pool.reter('ssh-1');
  await pool.close('ssh-1');
  await pool.acquire('ssh-1');
  r.avancar(DEZ_MIN + 1);
  await pool.sweep();

  assert.equal(sessoes[1]!.closed(), true);
});
