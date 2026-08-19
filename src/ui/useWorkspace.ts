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
import { proximoSemTitulo } from '../shared/untitled';
import { ICONE_DE_ARQUIVO, iconeDeArquivo } from '../shared/editor/arquivos';
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
  /**
   * Contador de edições do usuário.
   *
   * É o sinal do Auto Save: um número que muda a cada tecla, sem carregar o
   * conteúdo junto. Usar o próprio texto como dependência refaria o efeito a
   * cada caractere com uma cópia do arquivo inteiro.
   */
  readonly edicoes: number;
  aoMoverCursor(linha: number, coluna: number): void;
  abrirArquivo(caminho: string): Promise<void>;
  abrirQuery(id: string, titulo: string, conteudo: string, connectionId: string): void;
  /** Abre texto solto numa aba, sem arquivo em disco por trás. */
  abrirTexto(id: string, titulo: string, conteudo: string, linguagem: string): void;
  abrirFormulario(connectionId: string | null, titulo: string, grupoInicial?: string): void;
  abrirTerminal(connectionId: string | null, titulo: string): void;
  novoSemTitulo(): void;
  adotarArquivo(idAntigo: string, caminho: string): void;
  /** Devolve o caminho gravado, ou `null` se não havia o que salvar. */
  salvar(): Promise<string | null>;
  /**
   * Grava todas as abas sujas que já têm arquivo.
   *
   * Devolve quantas gravou e quantas ficaram de fora por ainda não terem nome —
   * quem chama decide como contar isso ao usuário.
   */
  salvarTodas(): Promise<{ readonly gravadas: number; readonly semNome: number }>;
  /** Relê o arquivo do disco, jogando fora o que não foi salvo. */
  reverter(): Promise<void>;
  marcarAbaSuja(id: string, sujo: boolean): void;
  ativar(id: string): void;
  fechar(id: string): Promise<void>;
  marcarSujo(): void;
}

/** A confirmação vem de fora: `shared` e este gancho não desenham diálogo. */
export interface WorkspaceDeps {
  confirmar(opcoes: {
    titulo?: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
}

export function useWorkspace({ confirmar }: WorkspaceDeps): Workspace {
  const { store, tabs, activeId, active } = useTabs();
  const editorRef = useRef<EditorHandle>(null);
  const [cursor, setCursor] = useState({ linha: 1, coluna: 1 });
  const [edicoes, setEdicoes] = useState(0);

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
        icon: iconeDeArquivo(dados.path, language),
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
   * Abre texto que não veio de arquivo — hoje, a saída da execução.
   *
   * Separado de `abrirQuery` porque aquele marca a aba como `sql`, e a saída de
   * um programa não é SQL. Reaproveitar por preguiça daria realce errado e um
   * botão "executar consulta" onde não há consulta.
   */
  const abrirTexto = useCallback(
    (id: string, titulo: string, conteudo: string, linguagem: string) => {
      if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);
      store.open({
        id,
        type: 'file',
        title: titulo,
        meta: { path: null, content: conteudo, language: linguagem, view: null },
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
    (connectionId: string | null, titulo: string, grupoInicial?: string) => {
      if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);
      store.open({
        id: connectionId === null ? 'conexao:nova' : `conexao:${connectionId}`,
        type: 'conexao',
        title: titulo,
        icon: 'lucide:plug',
        meta: { connectionId, grupoInicial: grupoInicial ?? null },
      });
    },
    [salvarNaAba, store]
  );

  /**
   * Abre uma aba de terminal.
   *
   * O id inclui um contador porque dois terminais da mesma conexão são
   * legítimos — ao contrário do formulário, onde reabrir deve focar o existente.
   */
  const proximoTerminal = useRef(0);
  const abrirTerminal = useCallback(
    (connectionId: string | null, titulo: string) => {
      if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);
      proximoTerminal.current += 1;
      store.open({
        id: `terminal:${proximoTerminal.current}`,
        type: 'terminal',
        title: titulo,
        icon: 'terminal',
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

  /**
   * Abre uma aba sem título, sem perguntar nada.
   *
   * O nome só é pedido ao salvar — antes disso, exigir a extensão obrigaria a
   * decidir a linguagem antes de escrever a primeira linha.
   *
   * Nasce suja porque conteúdo que não está em disco é exatamente o que a marca
   * de não salvo significa.
   */
  const novoSemTitulo = useCallback(() => {
    if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);
    const titulo = proximoSemTitulo(store.list().map((t) => t.title));
    store.open({
      id: `untitled:${titulo}`,
      type: 'editor',
      title: titulo,
      dirty: true,
      icon: ICONE_DE_ARQUIVO,
      meta: { path: null, content: '', language: 'plain', view: null },
    });
  }, [salvarNaAba, store]);

  const fechar = useCallback(
    async (id: string) => {
      const aba = store.get(id);
      if (aba !== null && aba.dirty) {
        const ok = await confirmar({
          titulo: 'Alterações não salvas',
          mensagem: `"${aba.title}" tem alterações não salvas.\n\nFechar mesmo assim?`,
          rotuloConfirmar: 'fechar sem salvar',
          destrutivo: true,
        });
        if (!ok) return;
      }
      // (2) NÃO zera `ultimaAtiva` aqui — ver o comentário do topo.
      store.close(id);
    },
    [confirmar, store]
  );

  const marcarSujo = useCallback(() => {
    if (carregando.current) return; // troca de aba não é edição do usuário
    const id = ultimaAtiva.current;
    if (id === null) return;
    setEdicoes((n) => n + 1);
    const aba = store.get(id);
    if (aba !== null && !aba.dirty) store.update(id, { dirty: true });
  }, [store]);

  /**
   * Grava a aba ativa e devolve o caminho.
   *
   * Devolve `null` quando não há arquivo conhecido — aba sem título ou aba de
   * query. Quem chama decide o que fazer: no caso do sem-título, pedir o nome.
   * Este gancho não pergunta nada, para continuar sem depender de interface.
   */
  const salvar = useCallback(async (): Promise<string | null> => {
    const aba = active;
    const editor = editorRef.current;
    if (aba === null || editor === null || !ehEditavel(aba)) return null;

    const meta = metaDe(aba);
    if (meta.path === null) return null;

    await Api.saveFile(meta.path, editor.getValue());
    store.update(aba.id, { dirty: false });
    return meta.path;
  }, [active, store]);

  /**
   * Grava tudo que está sujo e tem para onde ir.
   *
   * O conteúdo da aba ATIVA vem do editor, não do estado da aba: o estado só é
   * atualizado ao trocar de aba, então salvar a partir dele gravaria a versão
   * de antes da última tecla (AC-2).
   */
  const salvarTodas = useCallback(async (): Promise<{ gravadas: number; semNome: number }> => {
    if (ultimaAtiva.current !== null) salvarNaAba(ultimaAtiva.current);

    const sujas = store.list().filter((aba) => aba.dirty && ehEditavel(aba));
    let gravadas = 0;
    let semNome = 0;

    for (const aba of sujas) {
      const meta = metaDe(aba);
      if (meta.path === null) {
        semNome += 1;
        continue;
      }
      await Api.saveFile(meta.path, meta.content);
      store.update(aba.id, { dirty: false });
      gravadas += 1;
    }
    return { gravadas, semNome };
  }, [salvarNaAba, store]);

  /**
   * Volta a aba ativa ao que está em disco.
   *
   * Deixa o erro subir quando o arquivo sumiu: reverter para o nada seria
   * destruir o que restou no editor (AC-14).
   */
  const reverter = useCallback(async (): Promise<void> => {
    const aba = active;
    const editor = editorRef.current;
    if (aba === null || editor === null || !ehEditavel(aba)) {
      throw new Error('Não há arquivo aberto para reverter.');
    }
    const meta = metaDe(aba);
    if (meta.path === null) {
      throw new Error('Esta aba ainda não foi salva — não há versão em disco para voltar.');
    }

    const dados = await Api.readFile(meta.path);
    carregando.current = true;
    try {
      editor.setValue(dados.content);
    } finally {
      carregando.current = false;
    }
    store.update(aba.id, { dirty: false, meta: { ...meta, content: dados.content, view: null } });
  }, [active, store]);

  /**
   * Liga a aba sem título ao arquivo recém-criado.
   *
   * Troca o id junto com o caminho: o id `untitled:...` deixaria a aba
   * invisível para `abrirArquivo`, que procura por `file:<caminho>` — e abrir o
   * mesmo arquivo pela árvore criaria uma segunda aba do mesmo conteúdo.
   */
  const adotarArquivo = useCallback(
    (idAntigo: string, caminho: string) => {
      const aba = store.get(idAntigo);
      if (aba === null) return;
      const language = linguagemDe(caminho);
      store.close(idAntigo);
      store.open({
        id: `file:${caminho}`,
        type: language === 'sql' ? 'sql' : 'editor',
        title: caminho.split('/').pop() ?? caminho,
        icon: iconeDeArquivo(caminho, language),
        dirty: false,
        meta: { ...metaDe(aba), path: caminho, language },
      });
      editorRef.current?.setLanguage(language);
    },
    [store]
  );

  return {
    store,
    tabs,
    activeId,
    active,
    editorRef,
    cursor,
    edicoes,
    abrirArquivo,
    abrirQuery,
    abrirTexto,
    abrirFormulario,
    abrirTerminal,
    novoSemTitulo,
    adotarArquivo,
    marcarAbaSuja,
    ativar: (id) => store.activate(id),
    fechar,
    marcarSujo,
    salvar,
    salvarTodas,
    reverter,
    aoMoverCursor: (linha, coluna) => setCursor({ linha, coluna }),
  };
}
