// Remove o diretório temporário da execução.
//
// Sem isto, cada execução deixa um /tmp/dev-ide-e2e-<porta> para trás — e como
// a porta muda a cada vez, eles se acumulam indefinidamente.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ARQUIVO_DO_REDIS, ARQUIVO_DO_SSHD } from './global-setup';

/**
 * Derruba o `sshd` descartável da spec 052.
 *
 * Ele roda como processo separado e sobrevive ao fim da suíte se ninguém o
 * matar — e um `sshd` órfão segurando uma porta alta faria a execução seguinte
 * falhar ao subir o dele.
 */
function derrubarSshd(dados: string): void {
  const marca = path.join(dados, ARQUIVO_DO_SSHD);
  try {
    const { pid, base } = JSON.parse(fs.readFileSync(marca, 'utf8')) as {
      pid?: number;
      base?: string;
    };
    if (typeof pid === 'number') process.kill(pid, 'SIGTERM');
    if (typeof base === 'string') fs.rmSync(base, { recursive: true, force: true });
  } catch {
    // Sem marca, sem `sshd`: a suíte roda igual em máquina que não tem um.
  }
}

/**
 * Derruba o `redis-server` descartável da spec 089.
 *
 * Mesma razão do `sshd`: órfão segurando uma porta faria a execução seguinte
 * falhar ao subir o dele.
 */
function derrubarRedis(dados: string): void {
  try {
    const { pid } = JSON.parse(
      fs.readFileSync(path.join(dados, ARQUIVO_DO_REDIS), 'utf8')
    ) as { pid?: number };
    if (typeof pid === 'number') process.kill(pid, 'SIGTERM');
  } catch {
    // Sem marca, sem Redis: a suíte roda igual em máquina que não tem um.
  }
}

export default function globalTeardown(): void {
  const dados = process.env.E2E_DATA;
  if (dados === undefined) return;
  derrubarSshd(dados);
  derrubarRedis(dados);
  fs.rmSync(dados, { recursive: true, force: true });
}
