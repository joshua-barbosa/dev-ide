// Terminais vivos.
//
// Existe por dois motivos, e os dois são sobre processo órfão:
//
// - Sem limite, uma aba em laço poderia abrir terminais até a máquina engasgar.
// - Sem lugar central, desligar o servidor deixaria `mysql` e `bash` rodando
//   sozinhos — e, no caso do cliente de banco, com o arquivo de credencial
//   ainda em disco.
import { TerminalSession, type OpcoesDeSessao } from './session';
import type { CanalDeTerminal } from './canal';

/** Teto de terminais simultâneos. Não é limite de recurso, é rede de proteção. */
const MAXIMO = 12;

/**
 * Quanto tempo uma sessão sobrevive sem ninguém ligado a ela.
 *
 * É o que faz o F5 não matar o terminal: a página cai, o socket fecha, e a
 * sessão espera o navegador voltar. Trinta segundos é folgado para um
 * recarregamento e curto para não deixar `bash` órfão quando a aba foi mesmo
 * fechada — e fechar a aba pelo botão continua matando na hora, sem espera.
 */
const PRAZO_DE_RECONEXAO_MS = 30_000;

export class TerminalRegistry {
  private readonly vivos = new Map<string, CanalDeTerminal>();
  /** Sessões soltas, esperando o navegador voltar. */
  private readonly esperando = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly maximo: number = MAXIMO,
    private readonly prazoDeReconexao: number = PRAZO_DE_RECONEXAO_MS
  ) {}

  get quantidade(): number {
    return this.vivos.size;
  }

  abrir(id: string, opcoes: OpcoesDeSessao): CanalDeTerminal {
    // A fábrica é passada, e não o objeto pronto: `registrar` confere id
    // repetido e limite ANTES de criar. Criar primeiro faria um PTY nascer só
    // para ser recusado — processo vazado a cada tentativa acima do teto.
    return this.registrar(id, () => new TerminalSession(opcoes));
  }

  /**
   * Registra um canal já pronto — o do SSH, que nasce assíncrono (spec 054).
   *
   * Separado de `abrir` porque abrir um canal remoto exige uma ida à rede, e
   * `abrir` é síncrono desde a spec 017. Fundir os dois obrigaria o PTY local,
   * que é imediato, a virar promessa por causa do outro.
   */
  abrirCanal(id: string, canal: CanalDeTerminal): CanalDeTerminal {
    return this.registrar(id, () => canal);
  }

  private registrar(id: string, criar: () => CanalDeTerminal): CanalDeTerminal {
    if (this.vivos.has(id)) {
      throw new Error(`Já existe um terminal com o id "${id}".`);
    }
    if (this.vivos.size >= this.maximo) {
      throw new Error(
        `Limite de ${this.maximo} terminais abertos atingido. Feche algum antes de abrir outro.`
      );
    }

    const sessao = criar();
    this.vivos.set(id, sessao);
    // Sai do registro sozinho ao morrer, seja por `close` ou por conta própria.
    sessao.onExit(() => {
      if (this.vivos.get(id) === sessao) this.vivos.delete(id);
    });
    return sessao;
  }

  obter(id: string): CanalDeTerminal | null {
    return this.vivos.get(id) ?? null;
  }

  /**
   * Solta a sessão sem matá-la, dando um prazo para alguém voltar.
   *
   * Chamado quando o socket cai. Se ninguém reatar, a sessão é encerrada —
   * senão um `bash` ficaria vivo para sempre depois de a aba ser fechada.
   */
  soltar(id: string): void {
    const sessao = this.vivos.get(id);
    if (sessao === undefined || this.esperando.has(id)) return;

    // Ninguém ouvindo: sem isto, os bytes iriam para um socket fechado.
    sessao.onData(null);
    const timer = setTimeout(() => {
      this.esperando.delete(id);
      this.fechar(id);
    }, this.prazoDeReconexao);
    // Não segura o processo do servidor no encerramento.
    timer.unref();
    this.esperando.set(id, timer);
  }

  /**
   * Reata uma sessão que estava esperando.
   *
   * Devolve `null` quando não há — e aí quem chamou abre uma nova, que é o
   * comportamento certo depois de o prazo estourar.
   */
  reatar(id: string): CanalDeTerminal | null {
    const timer = this.esperando.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.esperando.delete(id);
    }
    return this.vivos.get(id) ?? null;
  }

  /** Quantas sessões estão soltas esperando reconexão. */
  get esperandoReconexao(): number {
    return this.esperando.size;
  }

  fechar(id: string): void {
    const timer = this.esperando.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.esperando.delete(id);
    }
    const sessao = this.vivos.get(id);
    if (sessao === undefined) return;
    this.vivos.delete(id);
    sessao.close();
  }

  /** Chamado no desligamento do servidor. Nenhum processo pode sobreviver a ele. */
  fecharTodos(): void {
    for (const timer of this.esperando.values()) clearTimeout(timer);
    this.esperando.clear();
    for (const sessao of this.vivos.values()) sessao.close();
    this.vivos.clear();
  }
}
