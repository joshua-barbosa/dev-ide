// Ciclo de vida das sessões abertas.
//
// Abrir conexão com banco ou SSH é caro, então a sessão fica viva entre
// requisições. Em troca, o pool precisa garantir três coisas: não abrir duas
// sessões para a mesma conexão em chamadas concorrentes, fechar o que ficou
// ocioso, e não guardar entrada envenenada quando a abertura falha.
//
// O relógio é injetável para a ociosidade ser testável sem timer real.
import type { Session } from './types';

export type SessionFactory = (connectionId: string) => Promise<Session>;

export interface SessionPoolOptions {
  readonly idleTimeoutMs?: number;
  readonly now?: () => number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface Entry {
  readonly session: Session;
  lastUsedAt: number;
}

export class SessionPool {
  private readonly entries = new Map<string, Entry>();
  /** Aberturas em voo, para chamadas concorrentes compartilharem a mesma promessa. */
  private readonly pending = new Map<string, Promise<Session>>();
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly factory: SessionFactory,
    options: SessionPoolOptions = {}
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  openIds(): string[] {
    return [...this.entries.keys()];
  }

  isOpen(connectionId: string): boolean {
    return this.entries.has(connectionId);
  }

  /** Devolve a sessão viva da conexão, abrindo-a se necessário. */
  async acquire(connectionId: string): Promise<Session> {
    const existente = this.entries.get(connectionId);
    if (existente !== undefined) {
      existente.lastUsedAt = this.now();
      return existente.session;
    }

    const emVoo = this.pending.get(connectionId);
    if (emVoo !== undefined) return emVoo;

    const abertura = this.factory(connectionId)
      .then((session) => {
        this.entries.set(connectionId, { session, lastUsedAt: this.now() });

        // O servidor do outro lado pode encerrar a conexão sem avisar ninguém.
        // Sem despejar aqui, o pool seguiria entregando uma sessão morta até a
        // IDE ser reiniciada.
        session.onClosed?.(() => {
          const atual = this.entries.get(connectionId);
          if (atual?.session === session) this.entries.delete(connectionId);
        });

        return session;
      })
      .finally(() => {
        // Sempre limpa: falha na abertura não pode deixar promessa rejeitada em cache.
        this.pending.delete(connectionId);
      });

    this.pending.set(connectionId, abertura);
    return abertura;
  }

  async close(connectionId: string): Promise<void> {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) return;
    this.entries.delete(connectionId);
    await entry.session.close();
  }

  /** Fecha o que passou do tempo de ociosidade. Chamado por um intervalo no servidor. */
  async sweep(): Promise<void> {
    const limite = this.now() - this.idleTimeoutMs;
    const ociosas = [...this.entries.entries()]
      .filter(([, entry]) => entry.lastUsedAt <= limite)
      .map(([id]) => id);
    await Promise.all(ociosas.map((id) => this.closeQuietly(id)));
  }

  /** Fecha todas as sessões. Um close que falhe não impede os demais. */
  async closeAll(): Promise<void> {
    await Promise.all(this.openIds().map((id) => this.closeQuietly(id)));
  }

  private async closeQuietly(connectionId: string): Promise<void> {
    try {
      await this.close(connectionId);
    } catch {
      // A sessão já saiu do mapa; um erro ao fechar não deve derrubar o servidor.
      this.entries.delete(connectionId);
    }
  }
}
