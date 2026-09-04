// O lado cliente do socket de terminal — sem `vscode` nenhum.
//
// Separado do `terminalRemoto.ts` para poder ser exercitado FORA do editor:
// aqui está tudo que pode quebrar calado (a ordem das mensagens, a fila de
// teclas digitadas antes de o socket abrir, o tamanho que precisa descer até o
// PTY), e nada disso depende de uma janela.
//
// O protocolo é o mesmo que a IDE fala em `src/ui/terminal/TerminalHost.tsx`,
// contra `src/server/terminal/socket.ts`.

/** O formato de id que o socket aceita. Ver `ID_VALIDO` em `socket.ts`. */
export function novoIdDeTerminal(): string {
  return `term-${Math.random().toString(36).slice(2, 12)}`;
}

export interface DepsDoCanal {
  /** `null` abre o shell do usuário; um id abre o terminal daquela conexão. */
  readonly connectionId: string | null;
  readonly url: string;
  readonly id?: string;
  readonly cols?: number;
  readonly rows?: number;
  /** Bytes para a tela. Já vêm no dialeto do terminal, com as sequências. */
  escrever(texto: string): void;
  /** O processo do outro lado terminou, com este código. */
  fim(codigo: number): void;
  erro(mensagem: string): void;
  /** O socket caiu — por queda ou por fechamento nosso. */
  encerrado(): void;
}

export interface CanalDoTerminal {
  digitar(dados: string): void;
  redimensionar(cols: number, rows: number): void;
  /** Fecha DE PROPÓSITO: o motor mata o processo em vez de guardá-lo. */
  fechar(): void;
}

interface MensagemDoMotor {
  readonly tipo?: string;
  readonly dados?: string;
  readonly mensagem?: string;
  readonly exitCode?: number;
}

/** Uma linha de aviso no dialeto do terminal. */
export const emVermelho = (texto: string): string => `\r\n\x1b[31m${texto}\x1b[0m\r\n`;
export const emCinza = (texto: string): string => `\r\n\x1b[90m${texto}\x1b[0m\r\n`;

/**
 * Liga um terminal ao motor.
 *
 * Devolve na hora, com o socket ainda abrindo: quem chama já tem uma tela
 * pronta para receber teclas, e perder as primeiras seria o defeito mais
 * irritante possível — daí a fila.
 */
export function ligarAoMotor(deps: DepsDoCanal): CanalDoTerminal {
  const ws = new WebSocket(deps.url);
  const fila: string[] = [];
  let cols = deps.cols ?? 80;
  let rows = deps.rows ?? 24;

  const enviar = (msg: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.onopen = () => {
    enviar({
      tipo: 'abrir',
      id: deps.id ?? novoIdDeTerminal(),
      opcoes: { connectionId: deps.connectionId, cols, rows },
    });
    for (const texto of fila.splice(0)) enviar({ tipo: 'dados', dados: texto });
  };

  ws.onmessage = (evento: MessageEvent) => {
    let msg: MensagemDoMotor;
    try {
      msg = JSON.parse(String(evento.data)) as MensagemDoMotor;
    } catch {
      return;
    }
    if (msg.tipo === 'dados') deps.escrever(msg.dados ?? '');
    else if (msg.tipo === 'erro') deps.erro(msg.mensagem ?? 'Erro.');
    else if (msg.tipo === 'fim') deps.fim(msg.exitCode ?? 0);
  };

  ws.onerror = () => deps.erro('Não consegui falar com o motor da Braytech Code.');
  ws.onclose = () => deps.encerrado();

  return {
    digitar(dados) {
      // Antes de o socket abrir, GUARDA. Sem isto, quem começa a digitar no
      // instante em que o terminal aparece perde as primeiras teclas.
      if (ws.readyState !== WebSocket.OPEN) fila.push(dados);
      else enviar({ tipo: 'dados', dados });
    },
    redimensionar(novasCols, novasRows) {
      cols = novasCols;
      rows = novasRows;
      // O programa pergunta o tamanho ao TERMINAL: sem descer até o PTY, o
      // `vim` desenha numa tela de 80×24 dentro de uma janela larga.
      enviar({ tipo: 'tamanho', cols, rows });
    },
    fechar() {
      enviar({ tipo: 'fechar' });
      ws.close();
    },
  };
}
