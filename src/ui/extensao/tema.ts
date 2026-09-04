// O tema do painel vem do EDITOR, não da minha IDE.
//
// Ele perguntou: *"ele não consegue seguir o padrão de theme do próprio VSCode
// ou Cursor?"* — consegue, e é o certo. Toda webview do VS Code recebe as cores
// do tema ativo como variáveis CSS `--vscode-*`, e uma classe `vscode-dark`,
// `vscode-light` ou `vscode-high-contrast` no `body`.
//
// Antes eu fixava `criarTema('escuro')`, que é a paleta da Braytech Code. Num
// Cursor com tema claro — ou com qualquer tema que não o meu — a barra lateral
// destoava do resto da janela.
import { useEffect, useState } from 'react';
import type { Theme } from '@mui/material/styles';
import { paletaDe, type Paleta } from '../../shared/temas';
import { aplicarVariaveis, temaDaPaleta } from '../theme';

/** Lê uma variável do editor, caindo no padrão quando ela não existe. */
function cor(nome: string, padrao: string): string {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return valor === '' ? padrao : valor;
}

function ehClaro(): boolean {
  const c = document.body.classList;
  return c.contains('vscode-light') || c.contains('vscode-high-contrast-light');
}

/**
 * A paleta da IDE preenchida com as cores do editor.
 *
 * Cada campo aponta para a variável que o VS Code usa naquele mesmo papel —
 * `sideBar-background` para o painel, `editor-background` para o fundo — então
 * o painel encosta no resto da janela sem emenda visível.
 */
export function paletaDoEditor(): { readonly paleta: Paleta; readonly modo: 'dark' | 'light' } {
  const claro = ehClaro();
  // O padrão é a paleta da IDE: fora do VS Code não há variável nenhuma, e o
  // painel continua funcionando no navegador.
  const base = paletaDe(claro ? 'claro' : 'escuro');
  return {
    modo: claro ? 'light' : 'dark',
    paleta: {
      ...base,
      bg: cor('--vscode-sideBar-background', base.bg),
      bgPanel: cor('--vscode-sideBar-background', base.bgPanel),
      bgEditor: cor('--vscode-editor-background', base.bgEditor),
      border: cor('--vscode-panel-border', cor('--vscode-editorWidget-border', base.border)),
      fg: cor('--vscode-foreground', base.fg),
      fgDim: cor('--vscode-descriptionForeground', base.fgDim),
      accent: cor('--vscode-textLink-foreground', cor('--vscode-focusBorder', base.accent)),
      run: cor('--vscode-testing-iconPassed', cor('--vscode-charts-green', base.run)),
      error: cor('--vscode-errorForeground', base.error),
    },
  };
}

/**
 * O tema do MUI seguindo o editor, e refeito quando ele troca de tema.
 *
 * O VS Code não avisa a troca por evento: ele reescreve as variáveis e a classe
 * do `body`. Observar a classe é o gancho que existe.
 */
export function useTemaDoEditor(): Theme {
  const montar = (): Theme => {
    const { paleta, modo } = paletaDoEditor();
    // As partes que não passam pelo MUI (árvore, grade) leem as variáveis.
    aplicarVariaveis(paleta);
    return temaDaPaleta(paleta, modo);
  };

  const [tema, setTema] = useState(montar);

  useEffect(() => {
    const observador = new MutationObserver(() => setTema(montar()));
    observador.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observador.disconnect();
  }, []);

  return tema;
}
