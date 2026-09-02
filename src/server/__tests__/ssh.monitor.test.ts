// O monitor remoto: a amostra e o `kill` (spec 056, T080, T082).
//
// **Sem servidor nenhum.** O `criarMonitorRemoto` recebe o executor por
// parâmetro, então o teste passa um que devolve texto combinado — e o que se
// prova aqui é a parte que erra de verdade: qual comando sai, e o que a IDE faz
// com o que volta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarMonitorRemoto } from '../connections/drivers/ssh-monitor';
import type { ComandoRemoto } from '../connections/types';

const SEP = '@@dev-ide@@';

/** Um executor de mentira que guarda o que foi pedido. */
function executorDe(
  resposta: (comando: string) => Partial<ComandoRemoto>
): { executar: (c: string) => Promise<ComandoRemoto>; pedidos: string[] } {
  const pedidos: string[] = [];
  return {
    pedidos,
    executar: async (comando: string) => {
      pedidos.push(comando);
      return { stdout: '', stderr: '', code: 0, ...resposta(comando) };
    },
  };
}

const AMOSTRA = [
  'cpu  100 0 50 800 50 0 0 0 0 0',
  'MemTotal: 1000 kB\nMemAvailable: 400 kB',
  [
    'Filesystem 1024-blocks Used Available Capacity Mounted on',
    'tmpfs 1000 10 990 1% /run',
    '/dev/sda1 100 40 60 40% /',
    '/dev/sdb1 900 800 100 89% /mnt/dados',
  ].join('\n'),
  '1000.0 900.0',
  '0.10 0.20 0.30 1/100 999',
  'PID USER PCPU PMEM RSS COMMAND\n42 joao 1.0 2.0 1024 node servidor.js',
  'Inter|   Receive |  Transmit',
].join(SEP);

test('uma amostra pede TODAS as partições, e não só a raiz (T082)', async () => {
  const { executar, pedidos } = executorDe(() => ({ stdout: AMOSTRA }));
  const m = criarMonitorRemoto(executar);
  const metricas = await m.sample();

  assert.equal(pedidos.length, 1, 'uma ida ao servidor por amostra');
  assert.match(pedidos[0] ?? '', /df -P -k(?! \/)/, '`df` sem caminho fixo');
  assert.deepEqual(metricas.discos.map((d) => d.ponto), ['/', '/mnt/dados']);
});

test('a primeira amostra não inventa CPU', async () => {
  // A segunda amostra precisa ter o relógio ANDADO: com o mesmo /proc/stat a
  // diferença é zero, e zero tique decorrido é `null` com razão.
  let vez = 0;
  const { executar } = executorDe(() => {
    vez += 1;
    return {
      stdout: vez === 1
        ? AMOSTRA
        : AMOSTRA.replace('cpu  100 0 50 800', 'cpu  200 0 90 1600'),
    };
  });
  const m = criarMonitorRemoto(executar);
  assert.equal((await m.sample()).cpu, null, 'porcentagem exige duas leituras');
  assert.notEqual((await m.sample()).cpu, null, 'a segunda já tem a diferença');
});

// ---------------------------------------------------------------------------
// T080 — encerrar processo
// ---------------------------------------------------------------------------

test('o sinal escolhido é o que vai no comando', async () => {
  const { executar, pedidos } = executorDe(() => ({}));
  const m = criarMonitorRemoto(executar);

  await m.matar?.(4242, 'TERM');
  await m.matar?.(4242, 'KILL');
  assert.deepEqual(pedidos, ['kill -TERM 4242', 'kill -KILL 4242']);
});

test('o comando NÃO redireciona o erro para a saída', async () => {
  // Com `2>&1` a mensagem iria para o `stdout`, a checagem do `stderr` não
  // veria nada e o kill falharia em silêncio. Foi um defeito de verdade.
  const { executar, pedidos } = executorDe(() => ({}));
  await criarMonitorRemoto(executar).matar?.(99, 'TERM');
  assert.equal((pedidos[0] ?? '').includes('2>&1'), false);
});

test('o erro do servidor sobe COMO VEIO', async () => {
  const { executar } = executorDe(() => ({
    stderr: 'kill: (1) - Operation not permitted',
    code: 1,
  }));
  await assert.rejects(
    () => criarMonitorRemoto(executar).matar?.(1234, 'TERM') ?? Promise.resolve(),
    // "Operation not permitted" diz que falta permissão; "no such process" diz
    // que ele já morreu. Trocar por "não foi possível" apaga o que resolve.
    /Operation not permitted/
  );
});

test('código de saída sujo sem mensagem ainda vira erro', async () => {
  const { executar } = executorDe(() => ({ code: 1 }));
  await assert.rejects(
    () => criarMonitorRemoto(executar).matar?.(1234, 'KILL') ?? Promise.resolve(),
    /falhou/
  );
});

test('PID que não é número não vira comando', async () => {
  const { executar, pedidos } = executorDe(() => ({}));
  const m = criarMonitorRemoto(executar);
  for (const ruim of [Number.NaN, 1.5, -3, 0]) {
    await assert.rejects(() => m.matar?.(ruim, 'TERM') ?? Promise.resolve(), /PID inválido/);
  }
  // O `init` também não: matar o PID 1 derruba o servidor inteiro.
  await assert.rejects(() => m.matar?.(1, 'KILL') ?? Promise.resolve(), /PID inválido/);
  assert.deepEqual(pedidos, [], 'nada chegou a sair para o servidor');
});
