// Os temas, como dado.
//
// Mora em `shared` pelo mesmo motivo do esquema de preferências: declarar tema é
// declarar uma tabela, e o compilador consegue provar que nenhuma cor ficou de
// fora — o que um objeto solto no componente não daria.
//
// **As cores do tema escuro são as mesmas de antes**, e isso é de propósito: a
// spec 001 as escolheu para a IDE não parecer Material genérico, e trocá-las
// junto com "agora dá para escolher tema" misturaria duas mudanças.

export interface Paleta {
  /** Fundo da moldura (barras, lateral). */
  readonly bg: string;
  /** Fundo dos painéis. */
  readonly bgPanel: string;
  /** Fundo da área de texto — o mais escuro (ou o mais claro) dos três. */
  readonly bgEditor: string;
  readonly border: string;
  readonly fg: string;
  readonly fgDim: string;
  readonly accent: string;
  readonly run: string;
  readonly error: string;
  /** Realce de sintaxe. Sem `#`: é o formato que o Monaco espera. */
  readonly sintaxe: PaletaDeSintaxe;
  /** Fundo da seleção no editor, e o das outras ocorrências. */
  readonly selecao: string;
  readonly selecaoFraca: string;
  /**
   * Cores ANSI do terminal.
   *
   * Não é enfeite: o shell escolhe as cores dele (o prompt do `git`, o `ls`
   * colorido) supondo um fundo escuro. Sobre branco, o amarelo e o ciano
   * padrão do xterm somem. Sem esta paleta, o tema claro entrega um terminal
   * com metade do texto invisível.
   */
  readonly ansi: PaletaAnsi;
}

export interface PaletaAnsi {
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

export interface PaletaDeSintaxe {
  readonly reservada: string;
  readonly tipo: string;
  readonly funcao: string;
  readonly texto: string;
  readonly numero: string;
  readonly comentario: string;
  readonly constante: string;
  readonly operador: string;
}

export type NomeDoTema = 'escuro' | 'claro';

export const TEMAS = {
  escuro: {
    bg: '#1e1f26',
    bgPanel: '#24262e',
    bgEditor: '#16171c',
    border: '#34363f',
    fg: '#d8dae2',
    fgDim: '#8b8e99',
    accent: '#e8a838',
    run: '#4caf6e',
    error: '#e05b5b',
    selecao: '#3a4a63',
    // Um pouco mais claro que a seleção: é o que mostra as OUTRAS ocorrências
    // no multi-cursor, e confundi-las com a ativa tira metade da utilidade.
    selecaoFraca: '#2c3a4d',
    sintaxe: {
      reservada: 'c98ade',
      tipo: '5cc8c2',
      funcao: 'e8a838',
      texto: '9ecf7e',
      numero: 'd9a05b',
      comentario: '6b6e7a',
      constante: 'd88fb0',
      operador: '9aa0b0',
    },
    // A paleta padrão do xterm, mantida: já é feita para fundo escuro.
    ansi: {
      black: '#2e3138', red: '#e05b5b', green: '#4caf6e', yellow: '#e8a838',
      blue: '#5b9bd5', magenta: '#c98ade', cyan: '#5cc8c2', white: '#d8dae2',
      brightBlack: '#6b6e7a', brightRed: '#ff7b7b', brightGreen: '#6fd68f',
      brightYellow: '#ffc457', brightBlue: '#7db8ef', brightMagenta: '#dfa6f0',
      brightCyan: '#7fe0da', brightWhite: '#ffffff',
    },
  },
  claro: {
    bg: '#f0f0f2',
    bgPanel: '#f7f7f8',
    // O editor é o mais CLARO no tema claro, invertendo o papel que ele tem no
    // escuro: em ambos, a área de texto é a que mais se separa da moldura.
    bgEditor: '#ffffff',
    border: '#d6d6db',
    fg: '#22242b',
    fgDim: '#6b6e79',
    // Âmbar escurecido: o `#e8a838` do tema escuro fica ilegível sobre branco.
    accent: '#a86a08',
    run: '#1a7f37',
    error: '#c0322f',
    selecao: '#bcd6f5',
    selecaoFraca: '#dce8f8',
    sintaxe: {
      reservada: '8a29b8',
      tipo: '146b78',
      funcao: '8a5a00',
      texto: '297a2e',
      numero: 'a04a12',
      comentario: '8a8d96',
      constante: 'a8306a',
      operador: '5c6070',
    },
    // Escurecidas para o fundo branco. O "brilhante" aqui é mais SATURADO, não
    // mais claro — sobre branco, mais claro significa invisível.
    ansi: {
      black: '#22242b', red: '#c0322f', green: '#1a7f37', yellow: '#8a5a00',
      blue: '#1c5fb0', magenta: '#8a29b8', cyan: '#146b78', white: '#6b6e79',
      brightBlack: '#8a8d96', brightRed: '#a52521', brightGreen: '#136128',
      brightYellow: '#6d4700', brightBlue: '#134788', brightMagenta: '#6c1e91',
      brightCyan: '#0f525c', brightWhite: '#22242b',
    },
  },
} as const satisfies Record<NomeDoTema, Paleta>;

export const NOMES_DE_TEMA = Object.keys(TEMAS) as readonly NomeDoTema[];

export function ehTema(valor: string): valor is NomeDoTema {
  return Object.prototype.hasOwnProperty.call(TEMAS, valor);
}

/** Rótulo para o seletor. Separado da chave, que é a que vai ao `config.json`. */
export const ROTULO_DO_TEMA: Record<NomeDoTema, string> = {
  escuro: 'Escuro',
  claro: 'Claro',
};
