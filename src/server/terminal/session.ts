// Uma sessão de terminal: um processo sob um PTY.
//
// Por que PTY e não um cano: programas perguntam ao sistema se estão falando
// com um terminal (`isatty`). Num cano a resposta é não, e aí somem as cores,
// a saída passa a ser bufferizada em blocos, não há edição de linha, `vim` e
// `htop` não funcionam — e, o mais grave, Ctrl+C não interrompe nada, porque
// sem terminal não existe grupo de processos em primeiro plano para receber o
// sinal.
//
// O arquivo de credencial é responsabilidade desta classe do começo ao fim: ela
// escreve, e apaga no encerramento E na morte súbita do processo. Deixar isso
// com quem chama é como o segredo acabaria esquecido em disco.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as pty from 'node-pty';
import { arquivoDeDados } from '../paths';
import type { ComandoDeTerminal } from '../../shared/terminal/comando';

/** Espera antes de matar à força quem ignorou o pedido de encerrar. */
const PRAZO_ATE_MATAR_MS = 2_000;

export interface OpcoesDeSessao {
  readonly comando: ComandoDeTerminal;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
}

export interface Encerramento {
  readonly exitCode: number;
  readonly signal?: number;
}

export class TerminalSession {
  private readonly proc: pty.IPty;
  private readonly credencial: string | null;
  private encerrada = false;

  constructor(opcoes: OpcoesDeSessao) {
    const { comando } = opcoes;

    // ANTES de escrever a credencial: `node-pty` não lança quando o executável
    // não existe — ele deixa o processo auxiliar falhar com "execvp failed" e
    // sair com código 1. Isso viraria uma aba com uma mensagem críptica, e
    // pior, o segredo já teria ido para o disco.
    if (!existeNoPath(comando.exec)) {
      throw new Error(
        `"${comando.exec}" não está instalado ou não está no PATH. ` +
          'Instale o cliente para abrir esta conexão no terminal.'
      );
    }

    this.credencial = comando.credencial === null ? null : escreverCredencial(comando.credencial);

    try {
      this.proc = pty.spawn(comando.exec, [...comando.args], {
        name: 'xterm-256color',
        cols: opcoes.cols ?? 80,
        rows: opcoes.rows ?? 24,
        cwd: opcoes.cwd ?? os.homedir(),
        env: { ...process.env, ...comando.env } as Record<string, string>,
      });
    } catch (e) {
      // Qualquer outra falha de lançamento: o arquivo já existe neste ponto e
      // não haveria processo nenhum para apagá-lo depois.
      this.apagarCredencial();
      throw e;
    }

    // Sempre apaga, tenha a sessão sido fechada por quem pediu ou não.
    this.proc.onExit(() => {
      this.encerrada = true;
      this.apagarCredencial();
    });
  }

  get pid(): number {
    return this.proc.pid;
  }

  onData(ouvinte: (dados: string) => void): void {
    this.proc.onData(ouvinte);
  }

  onExit(ouvinte: (fim: Encerramento) => void): void {
    this.proc.onExit(({ exitCode, signal }) => ouvinte({ exitCode, signal }));
  }

  /** Entrada do usuário, byte a byte — inclusive Ctrl+C, que é `0x03`. */
  write(dados: string): void {
    if (!this.encerrada) this.proc.write(dados);
  }

  /**
   * Informa o novo tamanho ao terminal.
   *
   * Sem isso `vim` e `htop` desenham na largura errada — o programa pergunta o
   * tamanho ao terminal, não ao navegador.
   */
  resize(cols: number, rows: number): void {
    if (this.encerrada) return;
    // Zero trava alguns programas; o mínimo é 1.
    this.proc.resize(Math.max(1, Math.trunc(cols)), Math.max(1, Math.trunc(rows)));
  }

  /** Pede para encerrar e, se for ignorado, mata à força depois do prazo. */
  close(): void {
    if (this.encerrada) {
      this.apagarCredencial();
      return;
    }
    try {
      this.proc.kill();
    } catch {
      // Já morreu entre a checagem e aqui.
    }
    const forcar = setTimeout(() => {
      if (this.encerrada) return;
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // idem
      }
      this.apagarCredencial();
    }, PRAZO_ATE_MATAR_MS);
    // Não segura o processo do servidor no encerramento.
    forcar.unref();
  }

  private apagarCredencial(): void {
    if (this.credencial === null) return;
    fs.rmSync(this.credencial, { force: true });
  }
}

/** Procura o executável, aceitando caminho absoluto ou nome no PATH. */
function existeNoPath(exec: string): boolean {
  if (exec.includes('/')) return fs.existsSync(exec);
  const pastas = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d !== '');
  return pastas.some((pasta) => {
    try {
      fs.accessSync(path.join(pasta, exec), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Grava a credencial num arquivo `600` dentro de um diretório `700`.
 *
 * Nome aleatório para que dois terminais da mesma conexão não colidam, e para
 * que o caminho — que É visível em `ps` — não diga nada sobre a conexão.
 */
function escreverCredencial(conteudo: string): string {
  const dir = arquivoDeDados('terminal');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const arquivo = path.join(dir, `${crypto.randomBytes(9).toString('hex')}.cred`);
  fs.writeFileSync(arquivo, conteudo, { mode: 0o600 });
  return arquivo;
}
