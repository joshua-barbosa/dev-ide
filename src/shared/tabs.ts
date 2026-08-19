// Store das abas do editor.
//
// Só estado — nenhum DOM e nenhuma dependência de framework. Vive em `shared`
// porque é compilado por dois caminhos: pelo `tsc` do servidor, para os testes
// rodarem em node:test, e pelo Vite, para a interface consumir.
//
// A separação existe para que as regras chatas — qual aba fica ativa depois de
// fechar, não duplicar aba já aberta, preservar "não salvo" — sejam testáveis
// sem navegador.
//
// **Grupos (spec 020).** Cada aba pertence a um grupo, e cada grupo tem a sua
// aba ativa. Com um grupo só, tudo se comporta exatamente como antes — foi o
// critério para não reescrever os testes que já existiam. `activeId()` continua
// devolvendo a ativa do grupo FOCADO, que é o que a barra de status e os
// comandos precisam saber.

/** Grupos são numerados a partir de zero, na ordem da esquerda para a direita. */
export const GRUPO_PADRAO = 0;

export interface Tab {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly icon?: string;
  readonly dirty: boolean;
  readonly meta: Readonly<Record<string, unknown>>;
  /** A que grupo de editor a aba pertence. */
  readonly grupo: number;
}

/** O que `open` aceita: identidade obrigatória, o resto com padrão. */
export type TabInput = Partial<Tab> & Pick<Tab, 'id' | 'type' | 'title'>;

export type TabListener = (tabs: Tab[], activeId: string | null) => void;

export interface TabStore {
  list(): Tab[];
  get(id: string): Tab | null;
  /** A ativa do grupo FOCADO. */
  activeId(): string | null;
  active(): Tab | null;
  open(input: TabInput): Tab;
  close(id: string): void;
  activate(id: string): void;
  update(id: string, patch: Partial<Tab>): Tab | null;

  // ---- grupos (spec 020) ----
  /** Números dos grupos que têm alguma aba, em ordem. Nunca vazio. */
  grupos(): number[];
  /** Abas de um grupo, na ordem em que foram abertas. */
  doGrupo(grupo: number): Tab[];
  /** A ativa de um grupo específico. */
  ativaDoGrupo(grupo: number): string | null;
  grupoFocado(): number;
  focarGrupo(grupo: number): void;
  /** Move uma aba para outro grupo, ativando-a lá. */
  mover(id: string, grupo: number): void;

  /** Devolve a função que cancela a inscrição. */
  onChange(listener: TabListener): () => void;
}

export function createTabStore(): TabStore {
  let tabs: Tab[] = [];
  /** Uma ativa por grupo. Grupo sem entrada aqui não tem ativa. */
  let ativas = new Map<number, string | null>();
  let focado = GRUPO_PADRAO;
  let listeners: TabListener[] = [];

  const indexOf = (id: string): number => tabs.findIndex((tab) => tab.id === id);

  const list = (): Tab[] => tabs.slice();

  const doGrupo = (grupo: number): Tab[] => tabs.filter((t) => t.grupo === grupo);

  const grupos = (): number[] => {
    const usados = [...new Set(tabs.map((t) => t.grupo))].sort((a, b) => a - b);
    // Nunca vazio: sem aba nenhuma, ainda há um grupo para o editor morar.
    return usados.length === 0 ? [GRUPO_PADRAO] : usados;
  };

  const activeId = (): string | null => ativas.get(focado) ?? null;

  /**
   * Escolhe a ativa de um grupo depois de a anterior sair.
   *
   * Vizinha à direita, senão a da esquerda, senão nenhuma — a mesma regra que já
   * valia com uma lista só, agora dentro do grupo.
   */
  function reativar(grupo: number, indiceNoGrupo: number): void {
    const doGrupoAgora = doGrupo(grupo);
    const proxima = doGrupoAgora[indiceNoGrupo] ?? doGrupoAgora[indiceNoGrupo - 1] ?? null;
    ativas = new Map(ativas).set(grupo, proxima === null ? null : proxima.id);
  }

  function definirAtiva(grupo: number, id: string | null): void {
    ativas = new Map(ativas).set(grupo, id);
  }

  const get = (id: string): Tab | null => {
    const i = indexOf(id);
    return i === -1 ? null : tabs[i];
  };

  function notify(): void {
    const snapshot = list();
    const atual = activeId();
    // Um listener quebrado não pode impedir os demais de atualizarem a UI.
    for (const listener of listeners) {
      try {
        listener(snapshot, atual);
      } catch (err) {
        console.error('listener de abas falhou:', err);
      }
    }
  }

  function open(input: TabInput): Tab {
    const existente = indexOf(input.id);
    if (existente !== -1) {
      // Já aberta: foca, preservando o estado (conteúdo, dirty, cursor).
      // O foco vai para o GRUPO dela — reabrir um arquivo que está do outro
      // lado deve levar o olho até lá, não duplicar a aba.
      const aba = tabs[existente];
      focado = aba.grupo;
      definirAtiva(aba.grupo, aba.id);
      notify();
      return aba;
    }

    const grupo = input.grupo ?? focado;
    const aba: Tab = {
      id: input.id,
      type: input.type,
      title: input.title,
      icon: input.icon,
      dirty: input.dirty === true,
      meta: input.meta ?? {},
      grupo,
    };
    tabs = [...tabs, aba];
    focado = grupo;
    definirAtiva(grupo, aba.id);
    notify();
    return aba;
  }

  function close(id: string): void {
    const i = indexOf(id);
    if (i === -1) return;

    const aba = tabs[i];
    const grupo = aba.grupo;
    const indiceNoGrupo = doGrupo(grupo).findIndex((t) => t.id === id);
    const fechandoAtiva = ativas.get(grupo) === id;

    tabs = [...tabs.slice(0, i), ...tabs.slice(i + 1)];
    if (fechandoAtiva) reativar(grupo, indiceNoGrupo);

    // Grupo que ficou vazio some, e o foco volta para o primeiro que existir.
    // Sem isto sobraria uma metade em branco depois de fechar a última aba dela.
    if (doGrupo(grupo).length === 0 && grupos()[0] !== undefined && focado === grupo) {
      focado = grupos()[0] as number;
    }
    notify();
  }

  function activate(id: string): void {
    const i = indexOf(id);
    if (i === -1) return;
    const aba = tabs[i];
    if (focado === aba.grupo && ativas.get(aba.grupo) === id) return;
    focado = aba.grupo;
    definirAtiva(aba.grupo, id);
    notify();
  }

  function focarGrupo(grupo: number): void {
    if (focado === grupo) return;
    focado = grupo;
    notify();
  }

  /**
   * Move uma aba de grupo.
   *
   * O grupo de origem escolhe outra ativa, e o de destino passa a ter esta —
   * mover é também trazer o olho junto.
   */
  function mover(id: string, grupo: number): void {
    const i = indexOf(id);
    if (i === -1) return;
    const aba = tabs[i];
    if (aba.grupo === grupo) return;

    const origem = aba.grupo;
    const indiceNaOrigem = doGrupo(origem).findIndex((t) => t.id === id);
    const eraAtiva = ativas.get(origem) === id;

    tabs = [...tabs.slice(0, i), { ...aba, grupo }, ...tabs.slice(i + 1)];
    if (eraAtiva) reativar(origem, indiceNaOrigem);
    definirAtiva(grupo, id);
    focado = grupo;
    notify();
  }

  function update(id: string, patch: Partial<Tab>): Tab | null {
    const i = indexOf(id);
    if (i === -1) return null;

    // Cria uma aba nova em vez de mutar: quem guardou a referência anterior
    // continua vendo o estado antigo, sem surpresa.
    const atual = tabs[i];
    const nova: Tab = {
      id: atual.id,
      type: patch.type ?? atual.type,
      title: patch.title ?? atual.title,
      icon: patch.icon ?? atual.icon,
      dirty: patch.dirty === undefined ? atual.dirty : patch.dirty === true,
      meta: patch.meta ?? atual.meta,
      grupo: patch.grupo ?? atual.grupo,
    };
    tabs = [...tabs.slice(0, i), nova, ...tabs.slice(i + 1)];
    notify();
    return nova;
  }

  function onChange(listener: TabListener): () => void {
    listeners = [...listeners, listener];
    return () => {
      listeners = listeners.filter((item) => item !== listener);
    };
  }

  return {
    list,
    get,
    activeId,
    active: () => {
      const id = activeId();
      return id === null ? null : get(id);
    },
    open,
    close,
    activate,
    update,
    grupos,
    doGrupo,
    ativaDoGrupo: (grupo) => ativas.get(grupo) ?? null,
    grupoFocado: () => focado,
    focarGrupo,
    mover,
    onChange,
  };
}
