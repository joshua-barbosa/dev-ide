// Tema do editor, derivado dos tokens do projeto.
//
// Existe porque o Monaco chega com o `vs-dark`, que é o cinza-azulado do VS
// Code. Ao lado da nossa lateral e do nosso rodapé, ele parece um componente
// colado de outro lugar — que é exatamente o que a spec 001 evitou ao trazer o
// MUI com o tema do projeto em vez do azul padrão do Material.
//
// Desde a spec 017 as cores vêm da paleta em `shared/temas.ts`, e não de
// constantes aqui: era o único jeito de o editor acompanhar a troca de tema.
import * as monaco from 'monaco-editor';
import { paletaDe, type NomeDoTema } from '../../shared/temas';

export const NOME_DO_TEMA = 'dev-ide';

/**
 * Registra (ou re-registra) o tema do editor a partir da paleta.
 *
 * Re-registrar com o mesmo nome substitui a definição, e o Monaco repinta os
 * editores que já usam esse nome — é o que faz trocar de tema não exigir
 * remontar o editor nem recarregar a página.
 */
export function registrarTema(nome: NomeDoTema): void {
  const p = paletaDe(nome);
  const cor = { ...p.sintaxe, variavel: p.fg.slice(1), invalido: p.error.slice(1) };

  monaco.editor.defineTheme(NOME_DO_TEMA, {
    base: nome === 'escuro' ? 'vs-dark' : 'vs',
    // `false` seria começar do zero e ter que declarar cada regra de cada
    // linguagem; herdar mantém as que não nos interessam com valor razoável.
    inherit: true,
    rules: [
      { token: '', foreground: cor.variavel },
      { token: 'keyword', foreground: cor.reservada },
      { token: 'keyword.control', foreground: cor.reservada },
      { token: 'type', foreground: cor.tipo },
      { token: 'type.identifier', foreground: cor.tipo },
      { token: 'entity.name.class', foreground: cor.tipo },
      { token: 'identifier.function', foreground: cor.funcao },
      { token: 'entity.name.function', foreground: cor.funcao },
      { token: 'string', foreground: cor.texto },
      { token: 'string.sql', foreground: cor.texto },
      { token: 'number', foreground: cor.numero },
      { token: 'comment', foreground: cor.comentario, fontStyle: 'italic' },
      { token: 'constant', foreground: cor.constante },
      { token: 'variable', foreground: cor.variavel },
      { token: 'variable.predefined', foreground: cor.constante },
      { token: 'operator', foreground: cor.operador },
      { token: 'delimiter', foreground: cor.operador },
      { token: 'tag', foreground: cor.reservada },
      { token: 'attribute.name', foreground: cor.funcao },
      { token: 'attribute.value', foreground: cor.texto },
      { token: 'invalid', foreground: cor.invalido },
    ],
    colors: {
      'editor.background': p.bgEditor,
      'editor.foreground': p.fg,
      'editorLineNumber.foreground': p.fgDim,
      'editorLineNumber.activeForeground': p.accent,
      'editorCursor.foreground': p.accent,
      'editor.lineHighlightBackground': p.bg,
      'editor.selectionBackground': p.selecao,
      'editor.selectionHighlightBackground': p.selecaoFraca,
      'editorWidget.background': p.bgPanel,
      'editorWidget.border': p.border,
      'editorSuggestWidget.background': p.bgPanel,
      'editorSuggestWidget.selectedBackground': p.bg,
      'input.background': p.bg,
      'input.foreground': p.fg,
      'scrollbarSlider.background': `${p.border}aa`,
      'scrollbarSlider.hoverBackground': p.fgDim,
      'minimap.background': p.bgEditor,
    },
  });
}
