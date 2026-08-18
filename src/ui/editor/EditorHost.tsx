// Editor de código, sobre o Monaco.
//
// **A fachada imperativa é a mesma de antes da spec 010**, de propósito:
// `useWorkspace` consome `getValue`, `setValue`, `setLanguage`, `getViewState` e
// companhia, e manter essa interface é o que faz a troca do editor não vazar
// para o resto da interface — nem para os testes de aba, que cobrem as duas
// piores regressões da história do projeto.
//
// O que mudou por dentro:
//
// - Era uma `textarea` transparente sobre camada de realce, com rolagem
//   sincronizada à mão. Isso tinha um teto: `textarea` tem UM cursor, por
//   definição do HTML, e o usuário usa multi-cursor.
// - O realce era do nosso tokenizador. Agora é análise de verdade do Monaco.
//
// O `ViewState` continua sendo o nosso formato simples, e não o do Monaco: ele é
// guardado no `meta` da aba, que atravessa o store — e amarrar o store ao
// formato interno de uma biblioteca seria trocar um acoplamento por outro pior.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Box from '@mui/material/Box';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import { idDoMonaco } from '../../shared/editor/monaco-ids';
import { tokens } from '../theme';
import { NOME_DO_TEMA, registrarTema } from './tema';

// O caminho destes imports NÃO é o que a documentação sugere: o `exports` do
// pacote remapeia `./*` para `./esm/vs/*`, então `monaco-editor/esm/vs/...`
// duplica o prefixo e não resolve. Descoberto no spike da spec 010.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

registrarTema();

/** Cursor e rolagem, guardados por aba para voltar onde estava. */
export interface ViewState {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

export interface EditorHandle {
  getValue(): string;
  setValue(valor: string): void;
  getSelection(): string;
  setLanguage(lang: string): void;
  getLanguage(): string;
  goToLine(linha: number): void;
  getViewState(): ViewState;
  setViewState(view: ViewState | null): void;
  focus(): void;
  /** Roda uma ação do próprio editor, pelo id do Monaco. */
  executarAcao(idMonaco: string): void;
}

export interface EditorHostProps {
  readonly onChange: () => void;
  readonly onCursor: (linha: number, coluna: number) => void;
}

const TAMANHO_TAB = 4;

export const EditorHost = forwardRef<EditorHandle, EditorHostProps>(function EditorHost(
  { onChange, onCursor },
  ref
) {
  const caixa = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Callbacks por ref: o editor é criado uma vez, e capturar a versão do
  // primeiro render faria a barra de status congelar depois de trocar de aba.
  const aoMudar = useRef(onChange);
  const aoMoverCursor = useRef(onCursor);
  aoMudar.current = onChange;
  aoMoverCursor.current = onCursor;

  useEffect(() => {
    if (caixa.current === null) return;

    const ed = monaco.editor.create(caixa.current, {
      value: '',
      language: 'plaintext',
      theme: NOME_DO_TEMA,
      fontFamily: tokens.fontMono,
      fontSize: 13,
      lineHeight: 20,
      tabSize: TAMANHO_TAB,
      insertSpaces: true,
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      // A IDE tem barra de status própria; a do Monaco duplicaria a informação.
      contextmenu: true,
      fixedOverflowWidgets: true,
    });
    editor.current = ed;

    const mudou = ed.onDidChangeModelContent(() => aoMudar.current());
    const moveu = ed.onDidChangeCursorPosition((e) =>
      aoMoverCursor.current(e.position.lineNumber, e.position.column)
    );

    return () => {
      mudou.dispose();
      moveu.dispose();
      ed.getModel()?.dispose();
      ed.dispose();
      editor.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      getValue: () => editor.current?.getValue() ?? '',

      setValue: (valor) => {
        const ed = editor.current;
        if (ed === undefined || ed === null) return;
        // `setValue` do modelo, e não `pushEditOperations`: trocar de aba não
        // deve deixar a troca no histórico de desfazer da aba anterior.
        ed.getModel()?.setValue(valor);
      },

      getSelection: () => {
        const ed = editor.current;
        const sel = ed?.getSelection();
        if (ed === null || sel === undefined || sel === null) return '';
        return ed.getModel()?.getValueInRange(sel) ?? '';
      },

      setLanguage: (lang) => {
        const modelo = editor.current?.getModel();
        if (modelo === undefined || modelo === null) return;
        monaco.editor.setModelLanguage(modelo, idDoMonaco(lang));
      },

      getLanguage: () => editor.current?.getModel()?.getLanguageId() ?? 'plaintext',

      goToLine: (linha) => {
        const ed = editor.current;
        if (ed === null) return;
        ed.revealLineInCenter(linha);
        ed.setPosition({ lineNumber: linha, column: 1 });
        ed.focus();
      },

      // O nosso `ViewState` é por deslocamento em caracteres, e não por
      // linha/coluna: é o formato que as abas já guardam, e mudá-lo obrigaria a
      // migrar o que está salvo no store.
      getViewState: () => {
        const ed = editor.current;
        const modelo = ed?.getModel();
        const sel = ed?.getSelection();
        if (ed === null || modelo === undefined || modelo === null || sel === undefined || sel === null) {
          return { selectionStart: 0, selectionEnd: 0, scrollTop: 0, scrollLeft: 0 };
        }
        return {
          selectionStart: modelo.getOffsetAt(sel.getStartPosition()),
          selectionEnd: modelo.getOffsetAt(sel.getEndPosition()),
          scrollTop: ed.getScrollTop(),
          scrollLeft: ed.getScrollLeft(),
        };
      },

      setViewState: (view) => {
        const ed = editor.current;
        const modelo = ed?.getModel();
        if (ed === null || modelo === undefined || modelo === null) return;
        if (view === null) {
          ed.setPosition({ lineNumber: 1, column: 1 });
          ed.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
          return;
        }
        const inicio = modelo.getPositionAt(view.selectionStart);
        const fim = modelo.getPositionAt(view.selectionEnd);
        ed.setSelection(monaco.Selection.fromPositions(inicio, fim));
        ed.setScrollPosition({ scrollTop: view.scrollTop, scrollLeft: view.scrollLeft });
      },

      focus: () => editor.current?.focus(),

      executarAcao: (idMonaco) => {
        const ed = editor.current;
        if (ed === null) return;
        // O foco precisa estar no editor: várias ações do Monaco não fazem
        // nada sem ele, e o clique veio de um item de menu.
        ed.focus();
        ed.getAction(idMonaco)?.run();
      },
    }),
    []
  );

  return (
    <Box
      ref={caixa}
      data-editor
      sx={{ flex: 1, minHeight: 0, minWidth: 0, bgcolor: tokens.bgEditor }}
    />
  );
});
