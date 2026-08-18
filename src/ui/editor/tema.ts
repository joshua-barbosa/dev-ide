// Tema do editor, derivado dos tokens do projeto.
//
// Existe porque o Monaco chega com o `vs-dark`, que é o cinza-azulado do VS
// Code. Ao lado da nossa lateral e do nosso rodapé, ele parece um componente
// colado de outro lugar — que é exatamente o que a spec 001 evitou ao trazer o
// MUI com o tema do projeto em vez do azul padrão do Material.
//
// As cores dos tokens saem de um princípio simples: manter as três âncoras que a
// IDE já tinha (`accent` para o que é estrutura, `run` para o que é valor,
// `error` para o que está errado) e derivar o resto delas.
import * as monaco from 'monaco-editor';
import { tokens } from '../theme';

export const NOME_DO_TEMA = 'dev-ide';

/** Cores de token. Sem `#` porque é o formato que o Monaco espera aqui. */
const cor = {
  reservada: 'c98ade', // roxo suave: estrutura da linguagem
  tipo: '5cc8c2', // ciano: tipos e classes
  funcao: tokens.accent.slice(1), // âmbar do projeto: o que se chama
  texto: '9ecf7e', // verde: literal de texto
  numero: 'd9a05b', // laranja queimado: literal numérico
  comentario: '6b6e7a', // cinza apagado, mas legível
  constante: 'd88fb0', // rosa: constante e enum
  variavel: tokens.fg.slice(1), // cor normal do texto
  operador: '9aa0b0',
  invalido: tokens.error.slice(1),
} as const;

export function registrarTema(): void {
  monaco.editor.defineTheme(NOME_DO_TEMA, {
    base: 'vs-dark',
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
      'editor.background': tokens.bgEditor,
      'editor.foreground': tokens.fg,
      'editorLineNumber.foreground': tokens.fgDim,
      'editorLineNumber.activeForeground': tokens.accent,
      'editorCursor.foreground': tokens.accent,
      'editor.lineHighlightBackground': tokens.bg,
      'editor.selectionBackground': '#3a4a63',
      // Um pouco mais claro que a seleção: é o que mostra as OUTRAS ocorrências
      // quando se usa multi-cursor, e confundi-las com a seleção ativa tira
      // metade da utilidade.
      'editor.selectionHighlightBackground': '#2c3a4d',
      'editorWidget.background': tokens.bgPanel,
      'editorWidget.border': tokens.border,
      'editorSuggestWidget.background': tokens.bgPanel,
      'editorSuggestWidget.selectedBackground': tokens.bg,
      'input.background': tokens.bg,
      'input.foreground': tokens.fg,
      'scrollbarSlider.background': `${tokens.border}aa`,
      'scrollbarSlider.hoverBackground': tokens.fgDim,
      'minimap.background': tokens.bgEditor,
    },
  });
}
