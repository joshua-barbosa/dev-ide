// O terminal que roda no SERVIDOR (spec 054).
//
// É o `RemoteShell` da spec 005 finalmente exercido. O canal vem do `ssh2`, e
// não do `node-pty`: o processo mora na outra máquina, e não há PTY local
// nenhum envolvido.
//
// **Por que não `ssh` pelo `node-pty`**, que seria reaproveitar o que existe:
// porque autenticar exigiria a senha na linha de comando ou um `sshpass`, e a
// senha do usuário não vai para linha de comando nem para arquivo temporário
// quando existe um caminho que não precisa disso. A conexão já está aberta e
// autenticada; abrir um canal nela é de graça.
import type { CanalDeTerminal, Encerramento } from './canal';
import type { ShellChannel } from '../connections/types';

/**
 * Quanto de saída se guarda para repintar quem reconecta.
 *
 * Mesmo valor e mesma razão do PTY local: um `cat` num log de 500 MB não pode
 * virar 500 MB de string no processo da IDE só porque alguém pode dar F5.
 */
const MAX_HISTORICO = 200_000;

export class CanalSsh implements CanalDeTerminal {
  private historicoTexto = '';
  private ouvinteDeDados: ((dados: string) => void) | null = null;
  private ouvinteDeSaida: ((fim: Encerramento) => void) | null = null;
  private encerrado = false;

  constructor(private readonly canal: ShellChannel) {
    canal.onData((pedaco) => {
      this.historicoTexto = (this.historicoTexto + pedaco).slice(-MAX_HISTORICO);
      this.ouvinteDeDados?.(pedaco);
    });
    canal.onClose((code) => {
      this.encerrado = true;
      this.ouvinteDeSaida?.({ exitCode: code ?? 0 });
    });
  }

  /** O processo é da outra máquina: não há PID deste lado. */
  get pid(): number | null {
    return null;
  }

  onData(ouvinte: ((dados: string) => void) | null): void {
    this.ouvinteDeDados = ouvinte;
  }

  historico(): string {
    return this.historicoTexto;
  }

  onExit(ouvinte: (fim: Encerramento) => void): void {
    this.ouvinteDeSaida = ouvinte;
    // Já tinha morrido antes de alguém assinar: avisa agora, senão a aba fica
    // esperando um evento que já passou.
    if (this.encerrado) ouvinte({ exitCode: 0 });
  }

  write(dados: string): void {
    if (!this.encerrado) this.canal.write(dados);
  }

  resize(cols: number, rows: number): void {
    if (!this.encerrado) this.canal.resize({ cols, rows });
  }

  close(): void {
    if (this.encerrado) return;
    this.encerrado = true;
    this.canal.close();
  }
}
