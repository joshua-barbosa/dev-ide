// Editor de código.
//
// Este é o componente que a constituição isenta do React de propósito: uma
// textarea transparente sobreposta a uma camada de realce, com rolagem
// sincronizada e numeração de linhas. É DOM imperativo por natureza — deixar o
// React reconciliar o conteúdo a cada tecla brigaria com o cursor e a seleção.
//
// O React monta a estrutura uma vez; daí em diante o componente se comporta como
// um controle não-controlado, e quem precisa mexer nele usa a ref imperativa.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import Box from '@mui/material/Box';
import { Highlighter } from '../../shared/editor/highlighter';
import { LANGUAGES } from '../../shared/editor/languages';
import { tokens } from '../theme';

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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const camada = useRef<HTMLPreElement>(null);
  const codigo = useRef<HTMLElement>(null);
  const linhas = useRef<HTMLDivElement>(null);
  const idioma = useRef('javascript');

  // Guardadas em ref para o efeito de montagem não depender delas: os handlers
  // são registrados uma vez só, e sempre chamam a versão atual.
  const aoMudar = useRef(onChange);
  aoMudar.current = onChange;
  const aoCursor = useRef(onCursor);
  aoCursor.current = onCursor;

  const sincronizarRolagem = useCallback(() => {
    const area = textarea.current;
    if (area === null) return;
    if (camada.current !== null) {
      camada.current.scrollTop = area.scrollTop;
      camada.current.scrollLeft = area.scrollLeft;
    }
    if (linhas.current !== null) linhas.current.scrollTop = area.scrollTop;
  }, []);

  const desenhar = useCallback(() => {
    const area = textarea.current;
    if (area === null || codigo.current === null || linhas.current === null) return;

    const texto = area.value;
    // "\n" extra para a camada de realce acompanhar a última linha vazia.
    codigo.current.innerHTML = Highlighter.highlight(`${texto}\n`, idioma.current);
    const total = texto.split('\n').length;
    linhas.current.textContent = Array.from({ length: total }, (_, i) => i + 1).join('\n');
    sincronizarRolagem();
  }, [sincronizarRolagem]);

  const relatarCursor = useCallback(() => {
    const area = textarea.current;
    if (area === null) return;
    const antes = area.value.slice(0, area.selectionStart);
    aoCursor.current(antes.split('\n').length, area.selectionStart - antes.lastIndexOf('\n'));
  }, []);

  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      getValue: () => textarea.current?.value ?? '',
      setValue(valor) {
        if (textarea.current === null) return;
        textarea.current.value = valor;
        desenhar();
        relatarCursor();
      },
      getSelection() {
        const area = textarea.current;
        return area === null ? '' : area.value.slice(area.selectionStart, area.selectionEnd);
      },
      setLanguage(lang) {
        idioma.current = LANGUAGES[lang] === undefined ? 'plain' : lang;
        document.body.dataset.lang = idioma.current;
        desenhar();
      },
      getLanguage: () => idioma.current,
      goToLine(linha) {
        const area = textarea.current;
        if (area === null) return;
        const todas = area.value.split('\n');
        let pos = 0;
        for (let i = 0; i < Math.min(linha - 1, todas.length); i += 1) pos += todas[i].length + 1;
        area.focus();
        area.setSelectionRange(pos, pos + (todas[linha - 1]?.length ?? 0));
        const altura = parseFloat(getComputedStyle(area).lineHeight) || 19;
        area.scrollTop = Math.max(0, (linha - 5) * altura);
        sincronizarRolagem();
        relatarCursor();
      },
      getViewState: () => ({
        selectionStart: textarea.current?.selectionStart ?? 0,
        selectionEnd: textarea.current?.selectionEnd ?? 0,
        scrollTop: textarea.current?.scrollTop ?? 0,
        scrollLeft: textarea.current?.scrollLeft ?? 0,
      }),
      setViewState(view) {
        const area = textarea.current;
        if (area === null || view === null) return;
        area.setSelectionRange(view.selectionStart, view.selectionEnd);
        area.scrollTop = view.scrollTop;
        area.scrollLeft = view.scrollLeft;
        sincronizarRolagem();
        relatarCursor();
      },
      focus: () => textarea.current?.focus(),
    }),
    [desenhar, relatarCursor, sincronizarRolagem]
  );

  useEffect(() => {
    const area = textarea.current;
    if (area === null) return;

    const aoDigitar = () => {
      desenhar();
      relatarCursor();
      aoMudar.current();
    };
    const aoTeclar = (e: KeyboardEvent) => {
      // Tab indenta em vez de sair do editor.
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const { selectionStart: inicio, selectionEnd: fim, value } = area;
      area.value = value.slice(0, inicio) + ' '.repeat(TAMANHO_TAB) + value.slice(fim);
      area.selectionStart = area.selectionEnd = inicio + TAMANHO_TAB;
      aoDigitar();
    };

    area.addEventListener('input', aoDigitar);
    area.addEventListener('keydown', aoTeclar);
    area.addEventListener('scroll', sincronizarRolagem);
    area.addEventListener('keyup', relatarCursor);
    area.addEventListener('click', relatarCursor);
    desenhar();

    return () => {
      area.removeEventListener('input', aoDigitar);
      area.removeEventListener('keydown', aoTeclar);
      area.removeEventListener('scroll', sincronizarRolagem);
      area.removeEventListener('keyup', relatarCursor);
      area.removeEventListener('click', relatarCursor);
    };
  }, [desenhar, relatarCursor, sincronizarRolagem]);

  const fonte = {
    fontFamily: tokens.fontMono,
    fontSize: 13,
    lineHeight: 1.5,
    tabSize: TAMANHO_TAB,
  } as const;

  return (
    <Box sx={{ flex: 1, display: 'flex', minHeight: 0, bgcolor: tokens.bgEditor }}>
      <Box
        ref={linhas}
        sx={{
          ...fonte,
          // mesmo padding da versão anterior: 8px em cima/baixo, 4px à direita
          p: '8px 4px 8px 0',
          minWidth: 42,
          textAlign: 'right',
          color: 'text.secondary',
          borderRight: 1,
          borderColor: 'divider',
          userSelect: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre',
        }}
      />
      <Box sx={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <Box
          component="pre"
          ref={camada}
          aria-hidden
          sx={{
            ...fonte,
            position: 'absolute',
            inset: 0,
            m: 0,
            p: '8px 12px',
            pointerEvents: 'none',
            overflow: 'hidden',
            whiteSpace: 'pre',
            color: 'text.primary',
          }}
        >
          <Box component="code" ref={codigo} />
        </Box>
        <Box
          component="textarea"
          ref={textarea}
          spellCheck={false}
          autoComplete="off"
          placeholder="Abra ou crie um arquivo para começar..."
          sx={{
            ...fonte,
            position: 'absolute',
            inset: 0,
            m: 0,
            p: '8px 12px',
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflow: 'auto',
            whiteSpace: 'pre',
            background: 'transparent',
            // O texto real fica invisível: quem se vê é a camada de realce.
            color: 'transparent',
            caretColor: tokens.fg,
            '&::selection': { background: 'rgba(232,168,56,0.28)' },
          }}
        />
      </Box>
    </Box>
  );
});
