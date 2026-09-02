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
  /**
   * Quanto se espera pelo fechamento educado antes de dar a conexão por morta.
   *
   * Existe porque `close()` de um socket morto pode não voltar nunca, e a
   * requisição de desconectar ficava pendurada — que é como o usuário vê
   * "o desconectar não faz nada".
   */
  readonly closeTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** Três segundos: o suficiente para um `QUIT` educado, e pouco para esperar. */
const DEFAULT_CLOSE_TIMEOUT_MS = 3_000;

interface Entry {
  readonly session: Session;
  lastUsedAt: number;
}

/** Uma abertura em voo, com o botão de desistir. */
interface AberturaEmVoo {
  promessa: Promise<Session>;
  cancelada: boolean;
}

/**
 * Espera, mas não para sempre.
 *
 * Não cancela nada — não há como cancelar um `close` de socket —, apenas para
 * de esperar. O que ficou para trás termina de fundo.
 */
function comLimiteDeTempo(promessa: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolver) => {
    const relogio = setTimeout(resolver, ms);
    void promessa.finally(() => {
      clearTimeout(relogio);
      resolver();
    });
  });
}

export class SessionPool {
  private readonly entries = new Map<string, Entry>();
  /** Aberturas em voo, para chamadas concorrentes compartilharem a mesma promessa. */
  private readonly pending = new Map<string, AberturaEmVoo>();
  private readonly idleTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly factory: SessionFactory,
    options: SessionPoolOptions = {}
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
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
    if (emVoo !== undefined) return emVoo.promessa;

    // A ficha da abertura. Ela existe para o `close` poder DESISTIR de uma
    // conexão que ainda não abriu: sem isso, desconectar durante um `connect`
    // pendurado não fazia nada — a abertura continuava em voo e, quando (ou se)
    // terminasse, se registrava sozinha como conexão viva. Era o caso dele:
    // *"travou, nem consigo dar desconectar"*.
    const ficha: AberturaEmVoo = { promessa: Promise.resolve(null as never), cancelada: false };

    const abertura = this.factory(connectionId)
      .then((session) => {
        if (ficha.cancelada) {
          // Ele desistiu enquanto isto abria. A sessão não entra no mapa, e é
          // fechada de fundo — deixá-la aberta seria vazar um socket a cada
          // desistência.
          void Promise.resolve(session.close()).catch(() => undefined);
          throw new Error('A conexão foi desconectada antes de terminar de abrir.');
        }
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

    ficha.promessa = abertura;
    this.pending.set(connectionId, ficha);
    return abertura;
  }

  /**
   * Desconecta — e **sempre termina**.
   *
   * Duas travas diferentes moravam aqui, e as duas apareciam para o usuário
   * como "o desconectar não faz nada":
   *
   * 1. **Travou ABRINDO.** A sessão nunca chegou ao mapa, então o `close` não
   *    achava nada e voltava calado, enquanto a abertura seguia em voo. A ficha
   *    da abertura resolve isso: ela é marcada como cancelada, e quem chamar
   *    depois abre uma conexão nova em vez de entrar na fila da morta.
   * 2. **Travou FECHANDO.** `session.close()` de um socket morto pode não
   *    voltar nunca, e a requisição ficava pendurada. Agora há um limite: a
   *    entrada já saiu do mapa, então para a IDE ela está desconectada — o
   *    fechamento educado continua de fundo, e o que ele vê é imediato.
   */
  async close(connectionId: string): Promise<void> {
    const emVoo = this.pending.get(connectionId);
    if (emVoo !== undefined) {
      emVoo.cancelada = true;
      this.pending.delete(connectionId);
      // A rejeição é tratada aqui para não virar `unhandledRejection` quando
      // ninguém mais estiver esperando por esta abertura.
      void emVoo.promessa.catch(() => undefined);
    }

    const entry = this.entries.get(connectionId);
    if (entry === undefined) return;
    this.entries.delete(connectionId);

    await comLimiteDeTempo(
      Promise.resolve(entry.session.close()).catch(() => undefined),
      this.closeTimeoutMs
    );
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
