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
import type { NomeDoTema } from '../../shared/temas';
import { LINGUAGEM_TODAS, type Snippet } from '../../shared/snippets';
import { registrarCodeLensDeSql } from '../query/codelens';
import { emmetCSS, emmetHTML, emmetJSX, registerCustomSnippets } from 'emmet-monaco-es';
import { DIALETOS, EMMET_PADRAO, sintaxeDoDialeto, type ConfiguracaoDoEmmet } from '../../shared/emmet';
import { NOME_DO_TEMA, registrarTema } from './tema';
import { modeloDe } from './modelos';

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

/** Temas já definidos no Monaco, para não redefinir a cada render. */
const registrado = new Set<NomeDoTema>();

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
  /** Vai para linha E coluna — o que a caixa de "ir para" pede (spec 026). */
  goToPosition(linha: number, coluna: number): void;
  /** Quantas linhas o arquivo tem. Serve para limitar o salto. */
  totalDeLinhas(): number;
  /**
   * A URI do modelo deste editor.
   *
   * Existe por causa do CodeLens (spec 038): há um modelo POR GRUPO, e o clique
   * num `Run` precisa dizer de QUAL editor veio. Sem isto, com a tela dividida,
   * a query da esquerda rodaria com o arquivo da direita.
   */
  uriDoModelo(): string | null;
  /**
   * Põe neste editor o modelo de texto desta chave (T028).
   *
   * Duas abas com a MESMA chave recebem o MESMO modelo — é o que faz o arquivo
   * aberto em dois grupos ser um texto só. Substituiu o `setValue` na troca de
   * aba: `setValue` num modelo compartilhado apagaria o que o outro lado
   * acabou de escrever.
   */
  usarModelo(chave: string, conteudo: string, linguagem: string): void;
  /**
   * Onde o cursor está agora, em linha e coluna.
   *
   * Existe para a barra de status ser derivada de ESTADO, e não de evento: o
   * Monaco não dispara `onDidChangeCursorPosition` quando a posição pedida é a
   * que já valia, então carregar uma aba não garante um evento. Quem carrega
   * pergunta e conta.
   */
  posicaoDoCursor(): { readonly linha: number; readonly coluna: number };
  getViewState(): ViewState;
  setViewState(view: ViewState | null): void;
  focus(): void;
  /** Roda uma ação do próprio editor, pelo id do Monaco. */
  executarAcao(idMonaco: string): void;
  /**
   * Insere um snippet na posição do cursor.
   *
   * O corpo usa os marcadores do Monaco (`$1`, `${1:valor}`, `$0`), e quem
   * resolve Tab, valor padrão e **espelho** é ele — era exatamente o que o
   * backlog dava como impossível antes da troca do editor.
   */
  inserirSnippet(corpo: string): void;
  /**
   * O trecho em que Beautify, Minify e CodeSnap agem (spec 077).
   *
   * O que está SELECIONADO e, sem seleção, o documento inteiro — a regra do
   * `Format Selection` de qualquer editor, e ela vale para os três.
   */
  trechoDeTrabalho(): TrechoDeTrabalho | null;
  /**
   * Troca o trecho por outro texto, num passo que o `Ctrl+Z` desfaz.
   *
   * `executeEdits`, e não `setValue`: o segundo limpa a pilha de desfazer, e um
   * formatador que não se desfaz é um formatador que ninguém usa em arquivo
   * grande. O trecho volta INTEIRO como veio porque o alcance vai dentro dele:
   * entre ler e escrever há uma ida ao servidor, e reler a seleção depois
   * poderia escrever no lugar errado.
   */
  substituirTrecho(trecho: TrechoDeTrabalho, texto: string): void;
}

export interface TrechoDeTrabalho {
  readonly texto: string;
  /** A linha do ARQUIVO em que o trecho começa — o CodeSnap numera por ela. */
  readonly primeiraLinha: number;
  /** `true` quando não havia seleção e o trecho é o documento todo. */
  readonly inteiro: boolean;
  /** A linguagem como o MONACO a chama — é o que o `colorize` entende. */
  readonly linguagemDoMonaco: string;
  /** Opaco de propósito: só este arquivo sabe ler. */
  readonly alcance: unknown;
}

export interface EditorHostProps {
  readonly onChange: () => void;
  readonly onCursor: (linha: number, coluna: number) => void;
  /** Aparência, vinda do arquivo de preferências (spec 011). */
  readonly fontSize: number;
  readonly tabSize: number;
  readonly wordWrap: boolean;
  /** Tema (spec 017). Re-registrar repinta o editor sem remontá-lo. */
  readonly tema: NomeDoTema;
  /** Snippets a oferecer na conclusão (spec 019). */
  readonly snippets: readonly Snippet[];
  /** Como o Emmet está configurado (T022). Ausente = os padrões. */
  readonly emmet?: ConfiguracaoDoEmmet;
  /**
   * Executa um comando da IDE pedido de dentro do editor (spec 032).
   *
   * Existe porque o Monaco **consome** F12 e Shift+F12 com as ações dele. O
   * atalho global nunca via a tecla: o editor a engolia e não fazia nada, já
   * que não há provedor de definição registrado nele. É a mesma situação do
   * xterm com Ctrl+J na spec 014, e a saída é a mesma — devolver a tecla a
   * quem sabe o que fazer com ela.
   */
  readonly onComando: (id: string) => void;
}

export const EditorHost = forwardRef<EditorHandle, EditorHostProps>(function EditorHost(
  { onChange, onCursor, fontSize, tabSize, wordWrap, tema, snippets, onComando,
    emmet = EMMET_PADRAO },
  ref
) {
  const caixa = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Callbacks por ref: o editor é criado uma vez, e capturar a versão do
  // primeiro render faria a barra de status congelar depois de trocar de aba.
  const aoMudar = useRef(onChange);
  const aoMoverCursor = useRef(onCursor);
  const aoComandar = useRef(onComando);
  aoMudar.current = onChange;
  aoMoverCursor.current = onCursor;
  aoComandar.current = onComando;

  // O tema precisa existir ANTES do primeiro `create`, senão o editor nasce com
  // o `vs-dark` padrão e só repinta no efeito seguinte — um piscar visível.
  const temaAtual = useRef(tema);
  temaAtual.current = tema;
  if (!registrado.has(tema)) {
    registrarTema(tema);
    registrado.add(tema);
  }

  useEffect(() => {
    const embrulho = caixa.current;
    if (embrulho === null) return;

    const ed = monaco.editor.create(embrulho, {
      // Sem modelo ao nascer (T028). Deixar o Monaco criar um anônimo faria o
      // editor DONO dele, e o descarte automático levaria junto o modelo
      // compartilhado assim que o arranjo remontasse este grupo. Quem põe o
      // modelo é o efeito que carrega a aba do grupo.
      model: null,
      theme: NOME_DO_TEMA,
      fontFamily: tokens.fontMono,
      fontSize,
      tabSize,
      wordWrap: wordWrap ? 'on' : 'off',
      // Sem `lineHeight` fixo: o Monaco o deriva da fonte. Fixar 20 px, como
      // antes da spec 011, cortaria as letras assim que a fonte passasse disso.
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

    // Devolve à IDE as teclas que o Monaco reserva para ações que ele não tem
    // como cumprir.
    //
    // **O Monaco traz o próprio serviço de TypeScript, e ele enxerga só os
    // modelos abertos.** Sem isto, F12 dentro de `usa-lib.ts` pula para o
    // `import` da primeira linha em vez do arquivo onde a função está —
    // parece funcionar, e está errado. Quem sabe procurar no projeto inteiro é
    // o serviço do servidor (spec 032).
    ed.addCommand(monaco.KeyCode.F12, () => aoComandar.current('go.definition'));
    ed.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.F12,
      () => aoComandar.current('go.references')
    );

    return () => {
      mudou.dispose();
      moveu.dispose();
      // O modelo NÃO é descartado aqui: ele pode estar em uso pelo outro grupo,
      // e este editor é remontado a cada mudança na forma do arranjo. Quem o
      // descarta é quem fecha a última aba que o usa (ver `modelos.ts`).
      ed.dispose();
      editor.current = null;
    };
    // Sem dependências de propósito: os valores de aparência entram na criação
    // e depois são aplicados pelo efeito abaixo. Colocá-los aqui recriaria o
    // editor a cada mudança de fonte, jogando fora histórico e rolagem.
  }, []);

  /**
   * Emmet: `div.foo>ul>li*3` vira HTML ao apertar Tab.
   *
   * **Dependência nova, justificada (Artigo III).** Emmet é uma linguagem de
   * abreviação com sintaxe própria — filhos, irmãos, multiplicação, numeração,
   * atributos, agrupamento —, e escrever o motor do zero é desproporcional. Mas
   * o motor nem é a parte difícil: o difícil é decidir **quando** o Tab expande
   * e quando ele indenta, olhando o que está antes do cursor. `emmet-monaco-es`
   * (MIT) faz as duas coisas e depende do Monaco que já temos, em vez de trazer
   * um segundo.
   *
   * Vale só para HTML, CSS e JSX — que é a razão de este ter sido o último item
   * grande da fila, e não o primeiro.
   */
  useEffect(() => {
    // PHP entra na lista do HTML (spec 033). Quem decide se o cursor está numa
    // ilha de HTML ou dentro de `<?php ?>` é a própria biblioteca, olhando os
    // tokens do Monaco — foi o que tornou este item pequeno em vez de grande.
    //
    // Desde o T022 a lista vem do `config.json`, e o padrão é este mesmo. As
    // linguagens são ids do MONACO: `blade` é `php` e `twig` é `html` (T041),
    // então os dois já estão cobertos pelo padrão.
    const cfg = emmet;
    for (const dialeto of DIALETOS) {
      const meus = cfg.snippets[dialeto];
      if (Object.keys(meus).length > 0) {
        registerCustomSnippets(sintaxeDoDialeto(dialeto), { ...meus });
      }
    }

    // Lista VAZIA desliga o dialeto — é como se desliga o Emmet no CSS sem
    // inventar um interruptor separado.
    const descartar = [
      cfg.linguagens.html.length === 0 ? null : emmetHTML(monaco, [...cfg.linguagens.html]),
      cfg.linguagens.css.length === 0 ? null : emmetCSS(monaco, [...cfg.linguagens.css]),
      cfg.linguagens.jsx.length === 0 ? null : emmetJSX(monaco, [...cfg.linguagens.jsx]),
    ].filter((d): d is () => void => d !== null);
    return () => {
      for (const d of descartar) d();
    };
    // Reage à configuração: mudar o `config.json` religa o Emmet onde ele passou
    // a valer, sem F5.
  }, [emmet]);

  // Conclusão de snippet.
  //
  // Um provedor só, registrado para TODAS as linguagens, filtrando pela do
  // modelo na hora. A alternativa — um provedor por linguagem — teria que ser
  // desmontada e remontada a cada snippet criado, e sobraria provedor órfão de
  // linguagem que ficou sem snippet.
  const snippetsAtuais = useRef(snippets);
  snippetsAtuais.current = snippets;
  useEffect(() => {
    const provedor = monaco.languages.registerCompletionItemProvider('*', {
      provideCompletionItems: (modelo, posicao) => {
        const linguagem = modelo.getLanguageId();
        const palavra = modelo.getWordUntilPosition(posicao);
        const alcance = {
          startLineNumber: posicao.lineNumber,
          endLineNumber: posicao.lineNumber,
          startColumn: palavra.startColumn,
          endColumn: palavra.endColumn,
        };
        const suggestions = snippetsAtuais.current
          .filter((s) => s.linguagem === linguagem || s.linguagem === LINGUAGEM_TODAS)
          .map((s) => ({
            label: s.prefixo,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.nome,
            documentation: { value: `\`\`\`\n${s.corpo}\n\`\`\`` },
            insertText: s.corpo,
            // Sem isto o corpo entraria com `$1` como texto literal.
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: alcance,
          }));
        return { suggestions };
      },
    });
    return () => provedor.dispose();
  }, []);

  // O `Run | +Tab | JSON` acima de cada query (spec 038). Registrado por
  // LINGUAGEM e não por editor, então a função se protege de ser chamada duas
  // vezes — com a tela dividida, este efeito roda uma vez por grupo.
  useEffect(() => {
    registrarCodeLensDeSql();
  }, []);

  // Trocar de tema: re-registrar a definição com o mesmo nome faz o Monaco
  // repintar os editores que já a usam — sem remontar, sem perder histórico.
  useEffect(() => {
    registrarTema(tema);
    monaco.editor.setTheme(NOME_DO_TEMA);
  }, [tema]);

  // Aparência sem remontar: `updateOptions` é o caminho que o Monaco oferece
  // justamente para isso.
  useEffect(() => {
    editor.current?.updateOptions({
      fontSize,
      tabSize,
      wordWrap: wordWrap ? 'on' : 'off',
    });
  }, [fontSize, tabSize, wordWrap]);

  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      getValue: () => editor.current?.getValue() ?? '',

      usarModelo: (chave, conteudo, linguagem) => {
        const ed = editor.current;
        if (ed === null) return;
        const modelo = modeloDe(chave, conteudo, linguagem);
        // Só troca quando é outro: `setModel` com o mesmo modelo joga fora
        // rolagem e seleção sem motivo.
        if (ed.getModel() !== modelo) ed.setModel(modelo);
      },

      setValue: (valor) => {
        const ed = editor.current;
        if (ed === undefined || ed === null) return;
        // `setValue` do modelo, e não `pushEditOperations`: trocar de aba não
        // deve deixar a troca no histórico de desfazer da aba anterior.
        ed.getModel()?.setValue(valor);
      },

      trechoDeTrabalho: () => {
        const ed = editor.current;
        const modelo = ed?.getModel();
        if (ed === null || ed === undefined || modelo === undefined || modelo === null) return null;
        const selecao = ed.getSelection();
        const vazia = selecao === null || selecao.isEmpty();
        const alcance = vazia ? modelo.getFullModelRange() : selecao;
        return {
          texto: modelo.getValueInRange(alcance),
          primeiraLinha: alcance.startLineNumber,
          inteiro: vazia,
          linguagemDoMonaco: modelo.getLanguageId(),
          alcance,
        };
      },

      substituirTrecho: (trecho, texto) => {
        const ed = editor.current;
        if (ed === null || ed === undefined) return;
        ed.pushUndoStop();
        ed.executeEdits('formatacao', [
          { range: trecho.alcance as monaco.IRange, text: texto },
        ]);
        ed.pushUndoStop();
        const posicao = ed.getPosition();
        // Sem isto o texto novo pode ficar fora da tela e parecer que nada
        // aconteceu.
        if (posicao !== null) ed.revealPositionInCenterIfOutsideViewport(posicao);
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

      goToPosition: (linha, coluna) => {
        const ed = editor.current;
        if (ed === null) return;
        // `revealPositionInCenter` e não `revealLine`: com a coluna longe da
        // margem, centralizar só a linha deixaria o cursor fora da vista à
        // direita.
        const posicao = { lineNumber: linha, column: coluna };
        ed.revealPositionInCenter(posicao);
        // O Monaco já limita a coluna ao fim da linha; não é preciso saber o
        // tamanho dela aqui.
        ed.setPosition(posicao);
        ed.focus();
      },

      totalDeLinhas: () => editor.current?.getModel()?.getLineCount() ?? 0,

      posicaoDoCursor: () => {
        const p = editor.current?.getPosition();
        return { linha: p?.lineNumber ?? 1, coluna: p?.column ?? 1 };
      },
      uriDoModelo: () => editor.current?.getModel()?.uri.toString() ?? null,

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

      inserirSnippet: (corpo) => {
        const ed = editor.current;
        if (ed === null) return;
        ed.focus();
        // `snippetController2` é a peça do Monaco que trata marcador de parada.
        // Inserir com `executeEdits` colocaria `$1` como texto literal.
        const controlador = ed.getContribution('snippetController2') as
          | { insert(texto: string): void }
          | null;
        if (controlador === null) return;
        controlador.insert(corpo);
      },

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
