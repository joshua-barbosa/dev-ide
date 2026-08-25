// O que o socket de terminal precisa de uma sessão, seja ela qual for (spec 054).
//
// Até agora só havia um tipo: um PTY local, do `node-pty`. O terminal SSH é
// outro — um canal do `ssh2`, que roda no servidor remoto. Os dois têm a mesma
// forma vista de fora (escrever, redimensionar, ouvir, fechar), e é essa forma
// que o socket sempre usou.
//
// Escrever a interface DEPOIS de existir a segunda implementação é de propósito:
// ela saiu do que o `TerminalSession` já fazia, e não de um palpite sobre o que
// um terminal deveria ter.

export interface Encerramento {
  readonly exitCode: number;
  readonly signal?: number;
}

export interface CanalDeTerminal {
  /**
   * Um número que identifique o processo, quando houver.
   *
   * O PTY local tem PID; o canal SSH não tem nada equivalente deste lado — o
   * processo mora na outra máquina. `null` diz isso, e a tela não mostra o
   * campo em vez de mostrar um número inventado.
   */
  readonly pid: number | null;
  /** O ouvinte ATUAL. Um só, substituível: numa reconexão o novo toma o lugar. */
  onData(ouvinte: ((dados: string) => void) | null): void;
  /** A saída recente, para repintar a tela de quem reconecta. */
  historico(): string;
  onExit(ouvinte: (fim: Encerramento) => void): void;
  write(dados: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}
