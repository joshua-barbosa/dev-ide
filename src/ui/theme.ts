// Tema da interface.
//
// As cores não são escolhidas aqui: são as que a IDE já usava antes da migração.
// Sem isso, o Material entra com o azul padrão e a identidade de editor se perde.
//
// A densidade é definida uma vez, como padrão global. Material é desenhado para
// toque; uma IDE é teclado e informação densa. Ajustar componente a componente
// significaria sobrescrever para sempre.
import { createTheme } from '@mui/material/styles';

/** Tokens crus, para as partes que não passam pelo MUI (editor, árvore, grade). */
export const tokens = {
  bg: '#1e1f26',
  bgPanel: '#24262e',
  bgEditor: '#16171c',
  border: '#34363f',
  fg: '#d8dae2',
  fgDim: '#8b8e99',
  accent: '#e8a838',
  run: '#4caf6e',
  error: '#e05b5b',
  fontMono: "'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  fontUi: 'system-ui, -apple-system, sans-serif',
} as const;

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: tokens.accent, contrastText: tokens.bgEditor },
    success: { main: tokens.run },
    error: { main: tokens.error },
    background: { default: tokens.bg, paper: tokens.bgPanel },
    text: { primary: tokens.fg, secondary: tokens.fgDim },
    divider: tokens.border,
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
        '*::-webkit-scrollbar-thumb': {
          background: tokens.border,
          borderRadius: 5,
        },
        '*::-webkit-scrollbar-thumb:hover': { background: tokens.fgDim },
      },
    },
  },
});
