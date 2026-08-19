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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GRUPO_PADRAO, type Tab, type TabStore } from '../shared/tabs';
import {
  dividir as dividirLayout, LAYOUT_INICIAL, normalizarLayout, podeDividir,
  proximoGrupo, type Lado, type NoDeLayout,
} from '../shared/layout-editor';
import type { CargaDeArraste, Zona } from '../shared/arrastar';
import { proximoSemTitulo } from '../shared/untitled';
import { ICONE_DE_ARQUIVO, iconeDeArquivo } from '../shared/editor/arquivos';
import type { EditorHandle, ViewState } from './editor/EditorHost';
import { EXT_TO_LANG, NOME_TO_LANG } from '../shared/editor/languages';
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
  const nome = (caminho.split('/').pop() ?? caminho).toLowerCase();
  // Nome inteiro primeiro: `Dockerfile` e `Makefile` não têm extensão, e o
  // `split('.')` neles devolveria o próprio nome como se fosse uma.
  const porNome = NOME_TO_LANG[nome];
  if (porNome !== undefined) return porNome;

  if (!nome.includes('.')) return 'plain';
  const ext = `.${nome.split('.').pop() ?? ''}`;
  return EXT_TO_LANG[ext] ?? 'plain';
}

/**
 * Ponteiro de leitura para o editor do grupo focado.
 *
 * Não é um `ref` do React: é um objeto com **getter**, que resolve na hora para
 * a instância certa. Foi o que permitiu a divisão da tela não vazar para os
 * quinze lugares que já escreviam `ws.editorRef.current?.getValue()` — eles
 * continuam iguais e passam a falar com o editor que está em foco.
 */
export interface PonteiroDeEditor {
  readonly current: EditorHandle | null;
}

export interface Workspace {
  readonly store: TabStore;
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly active: Tab | null;
  readonly grupos: readonly number[];
  readonly grupoFocado: number;
  /** O arranjo dos grupos na tela (spec 025). */
  readonly layout: NoDeLayout;
  /** Verdadeiro enquanto couber outro grupo. */
  readonly podeDividir: boolean;
  readonly editorRef: PonteiroDeEditor;
  /** Ref de callback para o `EditorHost` de um grupo se registrar. */
  registrarEditor(grupo: number): (handle: EditorHandle | null) => void;
  /** Manda a aba ativa para o outro grupo, criando-o se preciso. */
  dividir(): void;
  /**
   * Trata o que foi solto sobre um grupo.
   *
   * `centro` abre ali mesmo; qualquer outra zona cria um grupo naquele lado.
   */
  soltarNoGrupo(grupoAlvo: number, zona: Zona, carga: CargaDeArraste): void;
  /** Abas mostrando o conteúdo renderizado em vez do texto. */
  readonly emPreview: ReadonlySet<string>;
  /** Alterna entre texto e renderizado na aba ativa. */
  alternarPreview(): void;
  /** O conteúdo atual de uma aba, já com o que não foi salvo. */
  conteudoDaAba(id: string): string;
  focarGrupo(grupo: number): void;
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
  const { store, tabs, activeId, active, grupos, grupoFocado } = useTabs();
  /** Uma instância de editor por grupo, preenchida por ref de callback. */
  const editores = useRef(new Map<number, EditorHandle | null>());
  const focoAtual = useRef(grupoFocado);
  focoAtual.current = grupoFocado;

  const editorRef = useMemo<PonteiroDeEditor>(
    () => ({
      get current(): EditorHandle | null {
        return editores.current.get(focoAtual.current) ?? null;
      },
    }),
    []
  );

  /**
   * Quantos editores existem agora. Muda quando um grupo ganha ou perde o seu.
   *
   * Existe porque a chegada de um editor é o gatilho para carregar a aba dele:
   * o grupo novo é renderizado no mesmo commit em que passa a existir, e sem
   * este contador o efeito rodaria com o mapa ainda vazio, marcaria a aba como
   * carregada e **nunca tentaria de novo** — foi exatamente o que aconteceu, e
   * o lado direito da tela dividida nascia em branco.
   */
  const [versaoDosEditores, setVersaoDosEditores] = useState(0);

  /**
   * Uma função por grupo, guardada.
   *
   * Devolver uma closure nova a cada render faria o React chamar a antiga com
   * `null` e a nova com o handle **a cada render** — e, como registrar mexe em
   * estado, isso viraria laço infinito.
   */
  const refsPorGrupo = useRef(new Map<number, (h: EditorHandle | null) => void>());
  const registrarEditor = useCallback((grupo: number) => {
    const existente = refsPorGrupo.current.get(grupo);
    if (existente !== undefined) return existente;

    const fn = (handle: EditorHandle | null): void => {
      if (handle === null) {
        editores.current.delete(grupo);
      } else {
        editores.current.set(grupo, handle);
        // **Instância NOVA não sabe de nada.** Trocar o arranjo muda a forma da
        // árvore, e o React remonta os editores que mudaram de lugar nela — o
        // que jogava fora o conteúdo e deixava o grupo em branco. Limpar a
        // guarda aqui faz o efeito carregar a aba de novo no editor novo.
        ultimaAtiva.current.delete(grupo);
      }
      setVersaoDosEditores((n) => n + 1);
    };
    refsPorGrupo.current.set(grupo, fn);
    return fn;
  }, []);

  const [cursor, setCursor] = useState({ linha: 1, coluna: 1 });
  const [edicoes, setEdicoes] = useState(0);
  const [emPreview, setEmPreview] = useState<ReadonlySet<string>>(new Set());
  const [layout, setLayout] = useState<NoDeLayout>(LAYOUT_INICIAL);

  /** Suprime o "sujou" que a própria troca de aba dispara ao recarregar o editor. */
  const carregando = useRef(false);
  /** A última aba carregada em CADA grupo — a guarda de reentrância, por grupo. */
  const ultimaAtiva = useRef(new Map<number, string | null>());

  /**
   * Guarda no store o que está no editor de `grupoDoEditor`.
   *
   * **O grupo é parâmetro, e não `aba.grupo`.** A diferença já custou um
   * defeito: ao dividir a tela, a aba muda de grupo ANTES de o efeito salvá-la,
   * e usar `aba.grupo` pegava o editor do lado novo — que ainda está em branco.
   * O resultado era o arquivo aparecer vazio do outro lado. Quem sabe de que
   * editor o conteúdo veio é quem chama.
   */
  const salvarNaAba = useCallback(
    (id: string, grupoDoEditor: number) => {
      const aba = store.get(id);
      const editor = editores.current.get(grupoDoEditor) ?? null;
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

  /**
   * Carrega em cada grupo a aba ativa dele.
   *
   * O laço é por grupo porque a divisão da tela tem **dois editores**, cada um
   * com a própria aba — e a troca de um não pode mexer no outro. As duas
   * armadilhas do topo continuam valendo, agora por grupo.
   */
  useEffect(() => {
    for (const grupo of grupos) {
      const ativa = store.ativaDoGrupo(grupo);
      if (ativa === ultimaAtiva.current.get(grupo)) continue;

      const editor = editores.current.get(grupo) ?? null;
      const aba = ativa === null ? null : store.get(ativa);

      // O editor do grupo ainda não existe: NÃO marca como carregada e sai. O
      // contador de editores traz o efeito de volta assim que ele nascer.
      if (aba !== null && ehEditavel(aba) && editor === null) continue;

      // (1) marca ANTES de salvar — ver o comentário do topo
      const anterior = ultimaAtiva.current.get(grupo) ?? null;
      ultimaAtiva.current.set(grupo, ativa);
      if (anterior !== null) salvarNaAba(anterior, grupo);

      if (aba === null) {
        // Sem aba, a posição do cursor anterior é estado velho na barra de status.
        if (grupo === grupoFocado) setCursor({ linha: 1, coluna: 1 });
        continue;
      }
      if (editor === null || !ehEditavel(aba)) continue;

      const meta = metaDe(aba);
      carregando.current = true;
      try {
        editor.setLanguage(meta.language);
        editor.setValue(meta.content);
        editor.setViewState(meta.view);
      } finally {
        carregando.current = false;
      }
    }

    // Grupo que sumiu não pode deixar rastro na guarda.
    for (const grupo of [...ultimaAtiva.current.keys()]) {
      if (!grupos.includes(grupo)) ultimaAtiva.current.delete(grupo);
    }
  }, [activeId, grupoFocado, grupos, salvarNaAba, store, tabs, versaoDosEditores]);

  /**
   * Mantém o arranjo em sincronia com quem realmente tem aba.
   *
   * São duas verdades — a árvore de layout e o store de abas — e elas se
   * desencontram quando a última aba de um grupo fecha. Reconciliar aqui é o
   * que impede uma metade de tela em branco sobrando na tela.
   *
   * O grupo em FOCO é preservado mesmo vazio: ele é o destino de "abrir agora",
   * e removê-lo faria a próxima aba nascer do lado errado.
   */
  useEffect(() => {
    const vivos = new Set(tabs.map((t) => t.grupo));
    vivos.add(grupoFocado);
    setLayout((atual) => {
      const novo = normalizarLayout(atual, vivos);
      // Compara pelo desenho: devolver objeto novo a cada render entraria em
      // laço, já que `layout` é dependência de quem o consome.
      return JSON.stringify(novo) === JSON.stringify(atual) ? atual : novo;
    });
  }, [tabs, grupoFocado]);

  /** Salva no store o que está no editor do grupo em foco. */
  const salvarGrupoFocado = useCallback(() => {
    const id = ultimaAtiva.current.get(focoAtual.current) ?? null;
    if (id !== null) salvarNaAba(id, focoAtual.current);
  }, [salvarNaAba]);

  /**
   * Descarrega TODOS os editores para o store.
   *
   * Obrigatório antes de mexer no arranjo: mudar a forma da árvore remonta os
   * editores que trocaram de lugar nela, e o que não estiver no store nesse
   * instante desaparece. Salvar só o grupo em foco deixaria os outros em branco
   * — foi exatamente o que aconteceu ao arrastar o segundo arquivo.
   */
  const salvarTodosOsGrupos = useCallback(() => {
    for (const [grupo, id] of ultimaAtiva.current) if (id !== null) salvarNaAba(id, grupo);
  }, [salvarNaAba]);

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
      salvarGrupoFocado();

      store.open({
        id: `file:${dados.path}`,
        type: language === 'sql' ? 'sql' : 'editor',
        title: dados.path.split('/').pop() ?? dados.path,
        icon: iconeDeArquivo(dados.path, language),
        meta: { path: dados.path, content: dados.content, language, view: null },
      });
    },
    [salvarGrupoFocado, store]
  );

  const abrirQuery = useCallback(
    (id: string, titulo: string, conteudo: string, connectionId: string) => {
      salvarGrupoFocado();
      store.open({
        id,
        type: 'sql',
        title: titulo,
        meta: { path: null, content: conteudo, language: 'sql', view: null, connectionId },
      });
    },
    [salvarGrupoFocado, store]
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
      salvarGrupoFocado();
      store.open({
        id,
        type: 'file',
        title: titulo,
        meta: { path: null, content: conteudo, language: linguagem, view: null },
      });
    },
    [salvarGrupoFocado, store]
  );

  /**
   * Abre a aba do formulário de conexão.
   *
   * O `id` inclui a conexão, então reabrir a mesma edição foca a aba existente
   * em vez de duplicar — regra que o store já tem e que já tem teste.
   */
  const abrirFormulario = useCallback(
    (connectionId: string | null, titulo: string, grupoInicial?: string) => {
      salvarGrupoFocado();
      store.open({
        id: connectionId === null ? 'conexao:nova' : `conexao:${connectionId}`,
        type: 'conexao',
        title: titulo,
        icon: 'lucide:plug',
        meta: { connectionId, grupoInicial: grupoInicial ?? null },
      });
    },
    [salvarGrupoFocado, store]
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
      salvarGrupoFocado();
      proximoTerminal.current += 1;
      store.open({
        id: `terminal:${proximoTerminal.current}`,
        type: 'terminal',
        title: titulo,
        icon: 'terminal',
        meta: { connectionId },
      });
    },
    [salvarGrupoFocado, store]
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
    salvarGrupoFocado();
    const titulo = proximoSemTitulo(store.list().map((t) => t.title));
    store.open({
      id: `untitled:${titulo}`,
      type: 'editor',
      title: titulo,
      dirty: true,
      icon: ICONE_DE_ARQUIVO,
      meta: { path: null, content: '', language: 'plain', view: null },
    });
  }, [salvarGrupoFocado, store]);

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
    const id = ultimaAtiva.current.get(focoAtual.current) ?? null;
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
    // Todos os grupos, não só o focado: "Save All" com a tela dividida tem que
    // gravar os dois lados.
    for (const [grupo, id] of ultimaAtiva.current) if (id !== null) salvarNaAba(id, grupo);

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
  }, [salvarGrupoFocado, store]);

  /**
   * Volta a aba ativa ao que está em disco.
   *
   * Deixa o erro subir quando o arquivo sumiu: reverter para o nada seria
   * destruir o que restou no editor (AC-14).
   */
  /**
   * Manda a aba ativa para o outro grupo.
   *
   * Com um grupo, cria o segundo; com dois, alterna de lado. Dois grupos é o
   * limite desta spec: cobre o pedido ("dividir a tela com mais de um arquivo")
   * e mantém a barra de abas legível numa janela de tamanho normal.
   */
  const dividir = useCallback(() => {
    const id = store.activeId();
    if (id === null) return;
    salvarTodosOsGrupos();
    const alvo = store.get(id)?.grupo ?? GRUPO_PADRAO;
    setLayout((atual) => {
      if (!podeDividir(atual)) return atual;
      const novo = proximoGrupo(atual);
      store.mover(id, novo);
      return dividirLayout(atual, alvo, 'direita', novo);
    });
  }, [salvarTodosOsGrupos, store]);

  /**
   * Abre um arquivo num grupo específico.
   *
   * Arquivo já aberto é MOVIDO, e não duplicado: arrastar da árvore algo que já
   * está numa aba significa "quero ele aqui", não "quero dois dele".
   */
  const abrirNoGrupo = useCallback(
    async (caminho: string, grupo: number): Promise<void> => {
      const jaAberta = store.get(`file:${caminho}`);
      if (jaAberta !== null) {
        store.mover(jaAberta.id, grupo);
        store.activate(jaAberta.id);
        return;
      }
      store.focarGrupo(grupo);
      await abrirArquivo(caminho);
    },
    [abrirArquivo, store]
  );

  const soltarNoGrupo = useCallback(
    (grupoAlvo: number, zona: Zona, carga: CargaDeArraste): void => {
      salvarTodosOsGrupos();

      const aplicar = (destino: number): void => {
        if (carga.tipo === 'aba') {
          store.mover(carga.id, destino);
          return;
        }
        void abrirNoGrupo(carga.caminho, destino);
      };

      if (zona === 'centro') {
        aplicar(grupoAlvo);
        return;
      }

      setLayout((atual) => {
        // No teto, soltar na borda vira soltar no centro: recusar em silêncio
        // deixaria o usuário arrastando de novo sem entender.
        if (!podeDividir(atual)) {
          aplicar(grupoAlvo);
          return atual;
        }
        const novo = proximoGrupo(atual);
        aplicar(novo);
        return dividirLayout(atual, grupoAlvo, zona as Lado, novo);
      });
    },
    [abrirNoGrupo, salvarTodosOsGrupos, store]
  );

  /**
   * Alterna a aba ativa entre o texto e o conteúdo renderizado.
   *
   * Salva o editor no store ANTES de trocar: o preview precisa mostrar o que
   * está na tela, inclusive o que ainda não foi gravado em disco. Sem isso, o
   * botão mostraria a versão de antes da última tecla.
   */
  const alternarPreview = useCallback(() => {
    const id = store.activeId();
    if (id === null) return;
    salvarGrupoFocado();
    setEmPreview((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, [salvarGrupoFocado, store]);

  const conteudoDaAba = useCallback(
    (id: string): string => {
      const aba = store.get(id);
      return aba === null ? '' : metaDe(aba).content;
    },
    [store]
  );

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
   *
   * **A primeira linha é o conserto de um defeito que apagava o trabalho na
   * tela.** O `content` do `meta` só é atualizado ao trocar de aba, e uma aba
   * sem título nunca foi trocada — então ele estava vazio. A aba nova nascia com
   * conteúdo vazio, o efeito carregava esse vazio no editor, e o texto sumia da
   * tela logo depois de ser salvo. Em disco o arquivo ficava certo, o que tornava
   * o defeito ainda mais confuso: parecia que salvar tinha apagado tudo.
   */
  const adotarArquivo = useCallback(
    (idAntigo: string, caminho: string) => {
      const abaOriginal = store.get(idAntigo);
      if (abaOriginal === null) return;
      salvarNaAba(idAntigo, abaOriginal.grupo);

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
        grupo: aba.grupo,
        meta: { ...metaDe(aba), path: caminho, language },
      });
      editorRef.current?.setLanguage(language);
    },
    [salvarNaAba, store]
  );

  return {
    store,
    tabs,
    activeId,
    active,
    grupos,
    grupoFocado,
    layout,
    podeDividir: podeDividir(layout),
    soltarNoGrupo,
    editorRef,
    registrarEditor,
    dividir,
    emPreview,
    alternarPreview,
    conteudoDaAba,
    focarGrupo: (grupo: number) => store.focarGrupo(grupo),
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
