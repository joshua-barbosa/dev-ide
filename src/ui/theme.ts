// Tema da interface.
//
// **`tokens` deixou de conter cores e passou a conter variáveis CSS** (spec
// 017). Antes eram valores fixos, importados em vinte lugares — e trocar de tema
// exigiria passar a paleta por props até a última caixa. Com variáveis, os
// mesmos `sx={{ bgcolor: tokens.bgEditor }}` continuam funcionando e mudam de
// cor quando o valor da variável muda no `:root`.
//
// As cores em si moram em `shared/temas.ts`, como dado testável. Aqui fica a
// ponte para o MUI e para o CSS.
//
// A densidade é definida uma vez, como padrão global. Material é desenhado para
// toque; uma IDE é teclado e informação densa.
import { createTheme, type Theme } from '@mui/material/styles';
import { paletaDe, type NomeDoTema, type Paleta } from '../shared/temas';

/** Prefixo curto e específico, para não colidir com variável de biblioteca. */
const VAR = '--di';

/**
 * Tokens para as partes que não passam pelo MUI (editor, árvore, grade).
 *
 * São **referências**, não cores. Quem precisa da cor de verdade — o Monaco e o
 * xterm, que pintam em canvas — recebe a paleta direto.
 */
export const tokens = {
  bg: `var(${VAR}-bg)`,
  bgPanel: `var(${VAR}-bg-panel)`,
  bgEditor: `var(${VAR}-bg-editor)`,
  border: `var(${VAR}-border)`,
  fg: `var(${VAR}-fg)`,
  fgDim: `var(${VAR}-fg-dim)`,
  accent: `var(${VAR}-accent)`,
  run: `var(${VAR}-run)`,
  error: `var(${VAR}-error)`,
  fontMono: "'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  fontUi: 'system-ui, -apple-system, sans-serif',
} as const;

/** Escreve a paleta no `:root`. É o que faz `tokens` resolver para cor. */
export function aplicarVariaveis(paleta: Paleta): void {
  const raiz = document.documentElement.style;
  raiz.setProperty(`${VAR}-bg`, paleta.bg);
  raiz.setProperty(`${VAR}-bg-panel`, paleta.bgPanel);
  raiz.setProperty(`${VAR}-bg-editor`, paleta.bgEditor);
  raiz.setProperty(`${VAR}-border`, paleta.border);
  raiz.setProperty(`${VAR}-fg`, paleta.fg);
  raiz.setProperty(`${VAR}-fg-dim`, paleta.fgDim);
  raiz.setProperty(`${VAR}-accent`, paleta.accent);
  raiz.setProperty(`${VAR}-run`, paleta.run);
  raiz.setProperty(`${VAR}-error`, paleta.error);
}

/**
 * Monta o tema do MUI a partir da paleta.
 *
 * Aqui vão as cores DE VERDADE, e não as variáveis: o MUI calcula variantes
 * (hover, disabled, contraste) a partir dos valores, e `var(--x)` não é
 * parseável por essa conta.
 */
export function criarTema(nome: NomeDoTema): Theme {
  return temaDaPaleta(paletaDe(nome), nome === 'escuro' ? 'dark' : 'light');
}

/**
 * O mesmo tema, a partir de uma paleta qualquer.
 *
 * Existe separado porque a extensão monta a paleta a partir das variáveis
 * `--vscode-*` do editor: dentro do VS Code quem manda no tema é o tema DELE, e
 * uma barra lateral pintada com as cores da minha IDE no meio do Cursor destoa.
 */
export function temaDaPaleta(p: Paleta, modo: 'dark' | 'light'): Theme {
  return createTheme({
    palette: {
      mode: modo,
      primary: { main: p.accent, contrastText: modo === 'dark' ? p.bgEditor : '#ffffff' },
      success: { main: p.run },
      error: { main: p.error },
      warning: { main: p.accent },
      background: { default: p.bg, paper: p.bgPanel },
      text: { primary: p.fg, secondary: p.fgDim },
      divider: p.border,
    },

    typography: {
      fontFamily: tokens.fontUi,
      fontSize: 13,
      button: { textTransform: 'none', fontWeight: 500 },
    },

    shape: { borderRadius: 4 },

    components: {
      // Densidade compacta como padrão, não caso a caso.
      MuiButton: { defaultProps: { size: 'small', disableElevation: true } },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiSelect: { defaultProps: { size: 'small' } },
      MuiCheckbox: { defaultProps: { size: 'small' } },
      MuiSwitch: { defaultProps: { size: 'small' } },
      MuiTab: { defaultProps: { disableRipple: true } },
      MuiMenuItem: { defaultProps: { dense: true } },
      MuiTooltip: { defaultProps: { enterDelay: 600 } },

      MuiCssBaseline: {
        styleOverrides: {
          // A IDE ocupa a janela inteira e nunca rola no corpo.
          'html, body, #root': { height: '100%', overflow: 'hidden' },
          body: { fontSize: 13 },
          // Barras de rolagem discretas, como as do editor.
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': { background: p.border, borderRadius: 5 },
          '*::-webkit-scrollbar-thumb:hover': { background: p.fgDim },
        },
      },
    },
  });
}
