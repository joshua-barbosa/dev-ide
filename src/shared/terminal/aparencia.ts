// A aparência de UM terminal (T086 · spec 058).
//
// Eu tinha recusado escrevendo que "a IDE já tem essas chaves no `config.json`,
// e duplicá-las por aba criaria duas verdades". O argumento vale para
// PREFERÊNCIA — e não é disso que se trata. O motivo dele:
//
//   *"eu posso querer ter uma visão diferente para cada terminal na hora, se eu
//    tenho N terminais abertos, eu posso querer diferenciar de algum jeito"*
//
// Ou seja: não é configurar a IDE, é marcar ESTE terminal para distingui-lo dos
// outros três que estão do lado. Por isso vive na aba e some no F5, como a
// largura de coluna da grade — e por isso HERDA o `config.json` em vez de
// substituí-lo. Uma segunda verdade só existiria se ela persistisse.

/** O que se pode mudar num terminal só. `undefined` = herda do `config.json`. */
export interface AparenciaDoTerminal {
  readonly fontSize?: number;
  readonly scrollback?: number;
  readonly cursorBlink?: boolean;
  readonly cursorStyle?: 'block' | 'underline' | 'bar';
}

export const FONTE_MINIMA = 8;
export const FONTE_MAXIMA = 32;
export const SCROLLBACK_MINIMO = 100;
export const SCROLLBACK_MAXIMO = 100_000;

export const ESTILOS_DE_CURSOR: readonly AparenciaDoTerminal['cursorStyle'][] = [
  'block',
  'underline',
  'bar',
];

function entre(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, Math.round(valor)));
}

/**
 * O que de fato vai para o emulador: o da aba, com o do `config.json` atrás.
 *
 * Devolve valores concretos porque o xterm não sabe herdar — quem herda é esta
 * função, num lugar só.
 */
export function resolverAparencia(
  daAba: AparenciaDoTerminal,
  padrao: { readonly fontSize: number }
): Required<AparenciaDoTerminal> {
  return {
    fontSize: entre(daAba.fontSize ?? padrao.fontSize, FONTE_MINIMA, FONTE_MAXIMA),
    scrollback: entre(daAba.scrollback ?? 5_000, SCROLLBACK_MINIMO, SCROLLBACK_MAXIMO),
    cursorBlink: daAba.cursorBlink ?? true,
    cursorStyle: daAba.cursorStyle ?? 'block',
  };
}

/** Mexeu em alguma coisa? É o que decide se a aba mostra a marca de "mexido". */
export function foiMexida(daAba: AparenciaDoTerminal): boolean {
  return (
    daAba.fontSize !== undefined ||
    daAba.scrollback !== undefined ||
    daAba.cursorBlink !== undefined ||
    daAba.cursorStyle !== undefined
  );
}

/** Volta a herdar tudo. É o desfazer, e sem ele não haveria como voltar. */
export const HERDA_TUDO: AparenciaDoTerminal = {};
