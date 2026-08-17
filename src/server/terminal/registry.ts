// Terminais vivos.
//
// Existe por dois motivos, e os dois são sobre processo órfão:
//
// - Sem limite, uma aba em laço poderia abrir terminais até a máquina engasgar.
// - Sem lugar central, desligar o servidor deixaria `mysql` e `bash` rodando
//   sozinhos — e, no caso do cliente de banco, com o arquivo de credencial
//   ainda em disco.
import { TerminalSession, type OpcoesDeSessao } from './session';

/** Teto de terminais simultâneos. Não é limite de recurso, é rede de proteção. */
const MAXIMO = 12;

export class TerminalRegistry {
  private readonly vivos = new Map<string, TerminalSession>();

  constructor(private readonly maximo: number = MAXIMO) {}

  get quantidade(): number {
    return this.vivos.size;
  }

  abrir(id: string, opcoes: OpcoesDeSessao): TerminalSession {
    if (this.vivos.has(id)) {
      throw new Error(`Já existe um terminal com o id "${id}".`);
    }
    if (this.vivos.size >= this.maximo) {
      throw new Error(
        `Limite de ${this.maximo} terminais abertos atingido. Feche algum antes de abrir outro.`
      );
    }

    const sessao = new TerminalSession(opcoes);
    this.vivos.set(id, sessao);
    // Sai do registro sozinho ao morrer, seja por `close` ou por conta própria.
    sessao.onExit(() => {
      if (this.vivos.get(id) === sessao) this.vivos.delete(id);
    });
    return sessao;
  }

  obter(id: string): TerminalSession | null {
    return this.vivos.get(id) ?? null;
  }

  fechar(id: string): void {
    const sessao = this.vivos.get(id);
    if (sessao === undefined) return;
    this.vivos.delete(id);
    sessao.close();
  }

  /** Chamado no desligamento do servidor. Nenhum processo pode sobreviver a ele. */
  fecharTodos(): void {
    for (const sessao of this.vivos.values()) sessao.close();
    this.vivos.clear();
  }
}
