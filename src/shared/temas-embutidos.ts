// As paletas embutidas, como dado.
//
// Uma tabela por tema, com TODAS as cores — o `satisfies` faz o compilador
// provar que nenhuma ficou de fora. Tema pela metade é pior que tema nenhum:
// falta uma cor e a tela fica com um buraco que ninguém sabe de onde veio.
//
// **As cores do `escuro` e do `claro` são as mesmas de antes**, de propósito: a
// spec 001 as escolheu para a IDE não parecer Material genérico, e trocá-las
// junto com "agora tem mais temas" misturaria duas mudanças.
//
// Os demais vieram do T012, com os conjuntos que ele escolheu. São paletas
// conhecidas, escritas à mão aqui: nada é lido de fora, nada depende de pacote.
import type { Paleta } from './temas';

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

  'one-dark': {
    bg: '#21252b',
    bgPanel: '#282c34',
    bgEditor: '#282c34',
    border: '#181a1f',
    fg: '#abb2bf',
    fgDim: '#5c6370',
    accent: '#61afef',
    run: '#98c379',
    error: '#e06c75',
    selecao: '#3e4451',
    selecaoFraca: '#2c313a',
    sintaxe: {
      reservada: 'c678dd',
      tipo: 'e5c07b',
      funcao: '61afef',
      texto: '98c379',
      numero: 'd19a66',
      comentario: '5c6370',
      constante: '56b6c2',
      operador: 'abb2bf',
    },
    ansi: {
      black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#5c6370', brightRed: '#ef8a92', brightGreen: '#b3d99a',
      brightYellow: '#f0d3a0', brightBlue: '#8ac6f5', brightMagenta: '#d9a3e8',
      brightCyan: '#7fd4d0', brightWhite: '#ffffff',
    },
  },
  dracula: {
    bg: '#21222c',
    bgPanel: '#282a36',
    bgEditor: '#282a36',
    border: '#44475a',
    fg: '#f8f8f2',
    fgDim: '#6272a4',
    accent: '#bd93f9',
    run: '#50fa7b',
    error: '#ff5555',
    selecao: '#44475a',
    selecaoFraca: '#343746',
    sintaxe: {
      reservada: 'ff79c6',
      tipo: '8be9fd',
      funcao: '50fa7b',
      texto: 'f1fa8c',
      numero: 'bd93f9',
      comentario: '6272a4',
      constante: 'bd93f9',
      operador: 'ff79c6',
    },
    ansi: {
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
      brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
      brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },
  'solarized-escuro': {
    bg: '#073642',
    bgPanel: '#04303a',
    bgEditor: '#002b36',
    border: '#0d4a58',
    fg: '#93a1a1',
    fgDim: '#586e75',
    accent: '#b58900',
    run: '#859900',
    error: '#dc322f',
    selecao: '#14505f',
    selecaoFraca: '#0b3d49',
    sintaxe: {
      reservada: '859900',
      tipo: 'b58900',
      funcao: '268bd2',
      texto: '2aa198',
      numero: 'd33682',
      comentario: '586e75',
      constante: '6c71c4',
      operador: '93a1a1',
    },
    ansi: {
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#93a1a1',
      brightYellow: '#839496', brightBlue: '#657b83', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
  'solarized-claro': {
    bg: '#eee8d5',
    bgPanel: '#f5efdc',
    bgEditor: '#fdf6e3',
    border: '#ded8c5',
    fg: '#586e75',
    fgDim: '#93a1a1',
    accent: '#b58900',
    run: '#859900',
    error: '#dc322f',
    selecao: '#d8d2bf',
    selecaoFraca: '#e8e2cf',
    sintaxe: {
      reservada: '859900',
      tipo: 'b58900',
      funcao: '268bd2',
      texto: '2aa198',
      numero: 'd33682',
      comentario: '93a1a1',
      constante: '6c71c4',
      operador: '586e75',
    },
    ansi: {
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
      brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
  nord: {
    bg: '#2e3440',
    bgPanel: '#3b4252',
    bgEditor: '#2e3440',
    border: '#434c5e',
    fg: '#d8dee9',
    fgDim: '#7b88a1',
    accent: '#88c0d0',
    run: '#a3be8c',
    error: '#bf616a',
    selecao: '#434c5e',
    selecaoFraca: '#3b4252',
    sintaxe: {
      reservada: '81a1c1',
      tipo: '8fbcbb',
      funcao: '88c0d0',
      texto: 'a3be8c',
      numero: 'b48ead',
      comentario: '616e88',
      constante: 'd08770',
      operador: 'eceff4',
    },
    ansi: {
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
  },
  'github-claro': {
    bg: '#f6f8fa',
    bgPanel: '#ffffff',
    bgEditor: '#ffffff',
    border: '#d0d7de',
    fg: '#1f2328',
    fgDim: '#656d76',
    accent: '#0969da',
    run: '#1a7f37',
    error: '#cf222e',
    selecao: '#b6e3ff',
    selecaoFraca: '#ddf4ff',
    sintaxe: {
      reservada: 'cf222e',
      tipo: '953800',
      funcao: '8250df',
      texto: '0a3069',
      numero: '0550ae',
      comentario: '6e7781',
      constante: '0550ae',
      operador: '24292f',
    },
    ansi: {
      black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
      blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37',
      brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9',
      brightCyan: '#3192aa', brightWhite: '#1f2328',
    },
  },
  'alto-contraste': {
    // Preto puro e cores saturadas: aqui o objetivo NÃO é ser agradável, é ser
    // legível para quem precisa de contraste máximo. Toda escolha "suave" dos
    // outros temas é justamente o que este desfaz.
    bg: '#000000',
    bgPanel: '#000000',
    bgEditor: '#000000',
    // A borda é VISÍVEL de propósito: no alto contraste do VS Code ela também
    // é, porque separar painéis por tom de cinza não funciona para quem precisa
    // deste tema.
    border: '#6fc3df',
    fg: '#ffffff',
    fgDim: '#d4d4d4',
    accent: '#ffd700',
    run: '#00e676',
    error: '#ff5f5f',
    selecao: '#0f5fa8',
    selecaoFraca: '#073763',
    sintaxe: {
      reservada: 'ff7ee6',
      tipo: '4ee6e6',
      funcao: 'ffd700',
      texto: '7cff7c',
      numero: 'ffab5c',
      comentario: 'b9b9b9',
      constante: 'ff9de0',
      operador: 'ffffff',
    },
    ansi: {
      black: '#000000', red: '#ff5f5f', green: '#00e676', yellow: '#ffd700',
      blue: '#5fafff', magenta: '#ff7ee6', cyan: '#4ee6e6', white: '#ffffff',
      brightBlack: '#b9b9b9', brightRed: '#ff8787', brightGreen: '#5cff9d',
      brightYellow: '#ffe95f', brightBlue: '#87ceff', brightMagenta: '#ffa8ee',
      brightCyan: '#87f5f5', brightWhite: '#ffffff',
    },
  },
} as const satisfies Record<string, Paleta>;

/** O nome de um tema que vem no código. Tema do usuário é qualquer texto. */
export type TemaEmbutido = keyof typeof TEMAS;

/** Rótulo para o seletor. Separado da chave, que é a que vai ao `config.json`. */
export const ROTULO_DO_TEMA: Record<TemaEmbutido, string> = {
  escuro: 'Escuro',
  claro: 'Claro',
  'one-dark': 'One Dark',
  dracula: 'Dracula',
  'solarized-escuro': 'Solarized Dark',
  'solarized-claro': 'Solarized Light',
  nord: 'Nord',
  'github-claro': 'GitHub Light',
  'alto-contraste': 'Alto contraste',
};

/**
 * Quais temas são CLAROS.
 *
 * Serve ao T013: seguir o sistema é escolher entre um claro e um escuro, e a
 * IDE precisa saber de que lado cada um está para não oferecer dois escuros.
 */
export const TEMAS_CLAROS: ReadonlySet<TemaEmbutido> = new Set<TemaEmbutido>([
  'claro',
  'solarized-claro',
  'github-claro',
]);
