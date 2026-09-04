// Um servidor SSH descartável, para a suíte (spec 052).
//
// **Por que não usar um servidor do usuário:** os testes precisam listar, e as
// fases seguintes precisam escrever e apagar. Contra máquina de verdade isso
// seria mexer no trabalho dele; contra um `sshd` nosso, num diretório temporário
// e numa porta alta, não há nada para estragar.
//
// **Por que não uma simulação em memória:** um servidor falso erra do mesmo
// jeito que o cliente erra — os dois saem da minha cabeça. O `sshd` de verdade
// é quem diz se o driver fala o protocolo.
//
// Autentica só por CHAVE, gerada aqui e jogada fora no fim. Nenhuma senha
// aparece em lugar nenhum.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SshdDeTeste {
  readonly porta: number;
  /** Para o teardown poder matá-lo — ele roda noutro módulo. */
  readonly pid: number | undefined;
  /** A pasta temporária inteira, para o teardown apagar. */
  readonly base: string;
  readonly usuario: string;
  readonly caminhoDaChave: string;
  /** A pasta que o teste pode sujar à vontade. */
  readonly raiz: string;
  parar(): void;
}

const SSHD = '/usr/sbin/sshd';

export function sshdDisponivel(): boolean {
  return fs.existsSync(SSHD);
}

/** Uma porta alta fixa por execução — o `sshd` não sorteia porta sozinho. */
const PORTA = Number(process.env.E2E_SSH_PORT ?? 22_022);

export function subirSshd(): SshdDeTeste {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-sshd-'));
  const raiz = path.join(base, 'arvore');
  fs.mkdirSync(raiz, { recursive: true });

  // Conteúdo previsível: é contra ele que os testes afirmam.
  fs.mkdirSync(path.join(raiz, 'aplicacao', 'src'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'aplicacao', 'README.md'), '# aplicação\n');
  fs.writeFileSync(path.join(raiz, 'aplicacao', 'src', 'main.ts'), 'export const x = 1;\n');

  // Um PNG DE VERDADE (1x1, transparente), para provar que imagem remota abre
  // no visualizador e não como texto — ele abriu um `.png` do servidor em
  // 03/09/2026 e viu os bytes no editor.
  fs.writeFileSync(
    path.join(raiz, 'aplicacao', 'ponto.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
      + 'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  fs.writeFileSync(path.join(raiz, '.env'), 'SEGREDO=nao-e-de-verdade\n');
  fs.writeFileSync(path.join(raiz, 'run.sh'), '#!/bin/sh\necho ola\n', { mode: 0o755 });
  fs.writeFileSync(path.join(raiz, 'notas.txt'), 'x'.repeat(2048));

  const chave = path.join(base, 'id_ed25519');
  const hostKey = path.join(base, 'host_ed25519');
  const gerar = (destino: string): void => {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', destino]);
  };
  gerar(chave);
  gerar(hostKey);

  const autorizadas = path.join(base, 'authorized_keys');
  fs.copyFileSync(`${chave}.pub`, autorizadas);
  fs.chmodSync(autorizadas, 0o600);

  const usuario = os.userInfo().username;
  const config = path.join(base, 'sshd_config');
  fs.writeFileSync(
    config,
    [
      `Port ${PORTA}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${hostKey}`,
      `AuthorizedKeysFile ${autorizadas}`,
      // Só chave: nenhuma senha existe neste servidor.
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes',
      'UsePAM no',
      // Sem privilégio de root não há como separar privilégios nem usar PID
      // file do sistema; este `sshd` roda como o próprio usuário.
      'StrictModes no',
      'Subsystem sftp internal-sftp',
      `PidFile ${path.join(base, 'sshd.pid')}`,
      'LogLevel ERROR',
      '',
    ].join('\n')
  );

  const processo: ChildProcess = spawn(SSHD, ['-D', '-e', '-f', config], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  processo.stderr?.on('data', (d: Buffer) => {
    const texto = d.toString();
    if (texto.trim() !== '') process.stderr.write(`[sshd de teste] ${texto}`);
  });

  return {
    porta: PORTA,
    pid: processo.pid,
    base,
    usuario,
    caminhoDaChave: chave,
    raiz,
    parar: () => {
      processo.kill('SIGTERM');
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Espera a porta aceitar conexão — o `sshd` leva alguns milissegundos. */
export async function esperarSshd(porta: number, tentativas = 60): Promise<boolean> {
  const net = await import('node:net');
  for (let i = 0; i < tentativas; i += 1) {
    const aberta = await new Promise<boolean>((resolver) => {
      const soquete = net.createConnection({ host: '127.0.0.1', port: porta });
      soquete.once('connect', () => {
        soquete.destroy();
        resolver(true);
      });
      soquete.once('error', () => resolver(false));
    });
    if (aberta) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
