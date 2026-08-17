// Orquestração de abas e editor.
//
// Há um editor só; trocar de aba salva o estado da anterior e carrega o da
// nova. Duas armadilhas desta lógica já custaram bugs na versão anterior e
// estão marcadas abaixo:
//
// 1. Salvar o estado chama `store.update`, que notifica de novo. Sem marcar a
//    aba corrente ANTES de salvar, a chamada reentrante não vê a guarda e
//    recursa até travar o navegador.
// 2. `null` significa "nenhuma aba". Usá-lo também para "aba fechada" faz a
//    guarda engolir o evento de fechar a última, e a barra de status fica presa
//    no arquivo anterior.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Tab, TabStore } from '../shared/tabs';
import type { EditorHandle, ViewState } from './editor/EditorHost';
import { EXT_TO_LANG } from '../shared/editor/languages';
import { Api } from './api';
import { useTabs } from './tabs/useTabs';

export interface EditorTabMeta {
  /** Caminho no disco; `null` em aba de query, que não tem arquivo. */
  readonly path: string | null;
  readonly content: string;
  readonly language: string;
  readonly view: ViewState | null;
  readonly connectionId?: string;
}

const EDITAVEIS = new Set(['editor', 'sql']);

const ehEditavel = (aba: Tab | null): boolean => aba !== null && EDITAVEIS.has(aba.type);
const metaDe = (aba: Tab): EditorTabMeta => aba.meta as unknown as EditorTabMeta;

export function linguagemDe(caminho: string): string {
  const ext = `.${caminho.split('.').pop()?.toLowerCase() ?? ''}`;
  return EXT_TO_LANG[ext] ?? 'plain';
}

export interface Workspace {
  readonly store: TabStore;
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly active: Tab | null;
  readonly editorRef: React.RefObject<EditorHandle | null>;
  readonly cursor: { readonly linha: number; readonly coluna: number };
  aoMoverCursor(linha: number, coluna: number): void;
  abrirArquivo(caminho: string): Promise<void>;
  abrirQuery(id: string, titulo: string, conteudo: string, connectionId: string): void;
  abrirFormulario(connectionId: string | null, titulo: string): void;
  marcarAbaSuja(id: string, sujo: boolean): void;
  ativar(id: string): void;
  fechar(id: string): void;
  marcarSujo(): void;
  salvar(): Promise<void>;
}

export function useWorkspace(): Workspace {
  const { store, tabs, activeId, active } = useTabs();
  const editorRef = useRef<EditorHandle>(null);
  const [cursor, setCursor] = useState({ linha: 1, coluna: 1 });

  /** Suprime o "sujou" que a própria troca de aba dispara ao recarregar o editor. */
  const carregando = useRef(false);
  const ultimaAtiva = useRef<string | null>(null);

  const salvarNaAba = useCallback(
    (id: string) => {
      const aba = store.get(id);
      const editor = editorRef.current;
      if (aba === null || editor === null || !ehEditavel(aba)) return;
      store.update(id, {
        meta: {
          ...metaDe(aba),
          content: editor.getValue(),
          language: editor.getLanguage(),
          view: editor.getViewState(),
        },
      });
    },
    [store]
  );

  useEffect(() => {
    if (activeId === ultimaAtiva.current) return;

    // (1) marca ANTES de salvar — ver o comentário do topo
    const anterior = ultimaAtiva.current;
    ultimaAtiva.current = activeId;
    if (anterior !== null) salvarNaAba(anterior);

    const editor = editorRef.current;
    const aba = activeId === null ? null : store.get(activeId);
    if (aba === null) {
      // Sem aba, a posição do cursor anterior é estado velho na barra de status.
      setCursor({ linha: 1, coluna: 1 });
      return;
    }
    if (editor === null || !ehEditavel(aba)) return;

    const meta = metaDe(aba);
    carregando.current = true;
    try {
      editor.setLanguage(meta.language);
      editor.setValue(meta.content);
      editor.setViewState(meta.view);
    } finally {
      carregando.current = false;
    }
  }, [activeId, salvarNaAba, store]);

  const abrirArquivo = useCallback(
    async (caminho: string) => {
      const jaAberta = store.get(`file:${caminho}`);
      if (jaAberta !== null) {
        // Já aberta: foca, preservando edições não salvas.
        store.activate(jaAberta.id);
        return;
      }

      const dados = await Api.readFile(caminho);
      const language = linguagemDe(dados.path);

      // Salva a aba corrente antes de abrir a nova, senão o conteúdo se perde.
      if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);

      store.open({
        id: `file:${dados.path}`,
        type: language === 'sql' ? 'sql' : 'editor',
        title: dados.path.split('/').pop() ?? dados.path,
        meta: { path: dados.path, content: dados.content, language, view: null },
      });
    },
    [salvarNaAba, store]
  );

  const abrirQuery = useCallback(
    (id: string, titulo: string, conteudo: string, connectionId: string) => {
      if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);
      store.open({
        id,
        type: 'sql',
        title: titulo,
        meta: { path: null, content: conteudo, language: 'sql', view: null, connectionId },
      });
    },
    [salvarNaAba, store]
  );

  /**
   * Abre a aba do formulário de conexão.
   *
   * O `id` inclui a conexão, então reabrir a mesma edição foca a aba existente
   * em vez de duplicar — regra que o store já tem e que já tem teste.
   */
  const abrirFormulario = useCallback(
    (connectionId: string | null, titulo: string) => {
      if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);
      store.open({
        id: connectionId === null ? 'conexao:nova' : `conexao:${connectionId}`,
        type: 'conexao',
        title: titulo,
        icon: 'lucide:plug',
        meta: { connectionId },
      });
    },
    [salvarNaAba, store]
  );

  const marcarAbaSuja = useCallback(
    (id: string, sujo: boolean) => {
      store.update(id, { dirty: sujo });
    },
    [store]
  );

  const fechar = useCallback(
    (id: string) => {
      const aba = store.get(id);
      if (aba !== null && aba.dirty) {
        const ok = window.confirm(`"${aba.title}" tem alterações não salvas. Fechar mesmo assim?`);
        if (!ok) return;
      }
      // (2) NÃO zera `ultimaAtiva` aqui — ver o comentário do topo.
      store.close(id);
    },
    [store]
  );

  const marcarSujo = useCallback(() => {
    if (carregando.current) return; // troca de aba não é edição do usuário
    const id = ultimaAtiva.current;
    if (id === null) return;
    const aba = store.get(id);
    if (aba !== null && !aba.dirty) store.update(id, { dirty: true });
  }, [store]);

  const salvar = useCallback(async () => {
    const aba = active;
    const editor = editorRef.current;
    if (aba === null || editor === null || !ehEditavel(aba)) return;

    const meta = metaDe(aba);
    if (meta.path === null) return; // aba de query não tem arquivo para salvar

    await Api.saveFile(meta.path, editor.getValue());
    store.update(aba.id, { dirty: false });
  }, [active, store]);

  return {
    store,
    tabs,
    activeId,
    active,
    editorRef,
    cursor,
    abrirArquivo,
    abrirQuery,
    abrirFormulario,
    marcarAbaSuja,
    ativar: (id) => store.activate(id),
    fechar,
    marcarSujo,
    salvar,
    aoMoverCursor: (linha, coluna) => setCursor({ linha, coluna }),
  };
}
