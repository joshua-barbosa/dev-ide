// Um `redis-server` descartável para a suíte (spec 089).
//
// Mesma regra do `sshd`: se a máquina não tem o binário, a conexão simplesmente
// não é criada e os testes que dependem dela são pulados — a suíte não pode
// ficar vermelha num ambiente sem Redis instalado.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export interface RedisDeTeste {
  readonly porta: number;
  readonly pid: number;
}

export function redisDisponivel(): boolean {
  return spawnSync('redis-server', ['--version']).status === 0;
}

function portaLivre(): number {
  const servidor = createServer();
  servidor.listen(0);
  const { port } = servidor.address() as { port: number };
  servidor.close();
  return port;
}

/**
 * Sobe o servidor SEM persistência.
 *
 * `--save ''` e `--appendonly no` porque um servidor de teste não pode deixar
 * `dump.rdb` na pasta de quem rodou a suíte.
 */
export function subirRedis(): { processo: ChildProcess } & RedisDeTeste {
  const porta = portaLivre();
  const processo = spawn(
    'redis-server',
    ['--port', String(porta), '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' }
  );
  return { processo, porta, pid: processo.pid ?? 0 };
}

/** Espera o servidor atender, em vez de dormir um tempo fixo. */
export async function esperarRedis(porta: number): Promise<boolean> {
  for (let i = 0; i < 60; i += 1) {
    const r = spawnSync('redis-cli', ['-p', String(porta), 'PING'], { encoding: 'utf8' });
    if (r.stdout.trim() === 'PONG') return true;
    await new Promise((pronto) => setTimeout(pronto, 100));
  }
  return false;
}

/** As chaves que os testes esperam encontrar. */
export function semear(porta: number): void {
  const cli = (...args: string[]): void => {
    spawnSync('redis-cli', ['-p', String(porta), ...args], { stdio: 'ignore' });
  };
  cli('SET', 'app:saudacao', 'bom dia');
  cli('SET', 'app:config', '{"tema":"escuro","linhas":100}');
  cli('RPUSH', 'app:fila', 'primeiro', 'segundo', 'terceiro');
  cli('HSET', 'app:usuario', 'nome', 'ana', 'papel', 'leitor');
  cli('ZADD', 'app:ranque', '9.5', 'ana', '7', 'bruno');
}
