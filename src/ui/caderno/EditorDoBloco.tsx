// Monaco de verdade, no bloco EM FOCO (T073, spec 071).
//
// A spec 050 (D17) decidiu que o bloco seria `textarea` com uma camada de cor,
// e a desculpa para não ter multi-cursor foi *"o bloco é pequeno"*. Ele
// respondeu na triagem com o desenho certo: **Monaco só no bloco em foco**.
//
// É o melhor dos dois: um caderno de trinta blocos não paga trinta editores —
// paga um, o que está sendo escrito —, e nele funcionam multi-cursor
// (`Ctrl+Alt+↓`, `Ctrl+D`), busca, dobradura e tudo o mais que o Monaco traz.
//
// **A posição do cursor atravessa a troca.** Sem isso, clicar no meio de uma
// linha para editar levaria o cursor para o começo do bloco — o gesto mais
// comum de todos ficaria irritante.
import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import * as monaco from 'monaco-editor';
import { idDoMonaco } from '../../shared/editor/monaco-ids';
import { NOME_DO_TEMA, registrarTema } from '../editor/tema';
import { tokens } from '../theme';
import type { NomeDoTema } from '../../shared/temas';

export interface EditorDoBlocoProps {
  readonly conteudo: string;
  readonly linguagem: string;
  readonly rotulo: string;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  /** Onde o cursor estava na camada de texto, em caracteres desde o começo. */
  readonly cursorEm: number;
  onAlterar(conteudo: string): void;
  onAtalhoDeRodar(): void;
  /** O bloco perdeu o foco: quem chama volta à camada de cor. */
  onSair(): void;
}

/** Altura mínima, para um bloco vazio não virar uma fresta de dois pixels. */
const MINIMA = 3;
const MAXIMA = 30;

export function EditorDoBloco({
  conteudo, linguagem, rotulo, fontSize, tabSize, tema, cursorEm,
  onAlterar, onAtalhoDeRodar, onSair,
}: EditorDoBlocoProps) {
  const caixa = useRef<HTMLDivElement>(null);
  // Por ref: o editor é criado UMA vez, e capturar a versão do primeiro render
  // faria o `onAlterar` gravar num caderno de dois renders atrás.
  const aoAlterar = useRef(onAlterar);
  const aoRodar = useRef(onAtalhoDeRodar);
  const aoSair = useRef(onSair);
  aoAlterar.current = onAlterar;
  aoRodar.current = onAtalhoDeRodar;
  aoSair.current = onSair;

  useEffect(() => {
    const embrulho = caixa.current;
    if (embrulho === null) return;
    registrarTema(tema);

    const ed = monaco.editor.create(embrulho, {
      value: conteudo,
      language: idDoMonaco(linguagem),
      theme: NOME_DO_TEMA,
      fontFamily: tokens.fontMono,
      fontSize,
      // A MESMA entrelinha da camada de cor (`estiloDoTexto` usa 1.5). Sem
      // fixar, o Monaco deriva a dele da fonte — e o bloco mudava de altura ao
      // ganhar foco, empurrando o que vem embaixo.
      lineHeight: Math.round(fontSize * 1.5),
      tabSize,
      insertSpaces: true,
      automaticLayout: true,
      // Um bloco não é um arquivo: minimapa, régua de rolagem e números de
      // linha roubariam a largura que o código usa.
      minimap: { enabled: false },
      // O bloco já tem `▷ Run ＋Tab JSON` na barra dele (spec 051). O CodeLens
      // de SQL é registrado por LINGUAGEM (spec 038), então ele aparecia aqui
      // dentro também — os mesmos três botões duas vezes, e uma linha a mais
      // empurrando o código para baixo.
      codeLens: false,
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      // Os 8px da esquerda são os do `padding` de `estiloDoTexto`: sem eles o
      // texto COLA na parede ao entrar em edição, e o bloco parece outro. Vem
      // por aqui, e não por `padding` do embrulho — mexer na caixa muda a
      // geometria das frestas de arrastar bloco, e o teste pegou.
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 0,
      overviewRulerLanes: 0,
      scrollbar: { vertical: 'hidden', alwaysConsumeMouseWheel: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      padding: { top: 8, bottom: 8 },
      wordWrap: 'on',
      fixedOverflowWidgets: true,
    });

    /** A caixa acompanha o conteúdo: um bloco não rola dentro de si. */
    const ajustarAltura = (): void => {
      const linha = ed.getOption(monaco.editor.EditorOption.lineHeight);
      const alturaDoTexto = ed.getContentHeight();
      const minima = MINIMA * linha + 16;
      const maxima = MAXIMA * linha + 16;
      embrulho.style.height = `${Math.min(maxima, Math.max(minima, alturaDoTexto))}px`;
      ed.layout();
    };
    ajustarAltura();

    // O cursor onde ele estava na camada de texto (ver o cabeçalho).
    const modelo = ed.getModel();
    if (modelo !== null) {
      const posicao = modelo.getPositionAt(Math.min(cursorEm, conteudo.length));
      ed.setPosition(posicao);
      ed.revealPositionInCenterIfOutsideViewport(posicao);
    }
    ed.focus();

    const mudou = ed.onDidChangeModelContent(() => {
      aoAlterar.current(ed.getValue());
      ajustarAltura();
    });
    const saiu = ed.onDidBlurEditorWidget(() => aoSair.current());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => aoRodar.current());

    return () => {
      mudou.dispose();
      saiu.dispose();
      ed.getModel()?.dispose();
      ed.dispose();
    };
    // Criado UMA vez por montagem: as dependências abaixo são o estado inicial,
    // e reagir a elas recriaria o editor sob os dedos de quem digita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      ref={caixa}
      data-editor-do-bloco
      aria-label={rotulo}
      // Os 8px laterais são os do `padding` de `estiloDoTexto`. O Monaco só
      // aceita `padding` em cima e embaixo, então a folga lateral vem daqui —
      // sem ela o texto COLA na parede ao entrar em edição, e o bloco parece
      // outro. Vertical continua com o `padding` do próprio editor.
      sx={{ width: '100%', minWidth: 0 }}
    />
  );
}
