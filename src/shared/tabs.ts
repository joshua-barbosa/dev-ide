// Store das abas do editor.
//
// Só estado — nenhum DOM e nenhuma dependência de framework. Vive em `shared`
// porque é compilado por dois caminhos: pelo `tsc` do servidor, para os testes
// rodarem em node:test, e pelo Vite, para a interface consumir.
//
// A separação existe para que as regras chatas — qual aba fica ativa depois de
// fechar, não duplicar aba já aberta, preservar "não salvo" — sejam testáveis
// sem navegador.

export interface Tab {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly icon?: string;
  readonly dirty: boolean;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** O que `open` aceita: identidade obrigatória, o resto com padrão. */
export type TabInput = Partial<Tab> & Pick<Tab, 'id' | 'type' | 'title'>;

export type TabListener = (tabs: Tab[], activeId: string | null) => void;

export interface TabStore {
  list(): Tab[];
  get(id: string): Tab | null;
  activeId(): string | null;
  active(): Tab | null;
  open(input: TabInput): Tab;
  close(id: string): void;
  activate(id: string): void;
  update(id: string, patch: Partial<Tab>): Tab | null;
  /** Devolve a função que cancela a inscrição. */
  onChange(listener: TabListener): () => void;
}

export function createTabStore(): TabStore {
  let tabs: Tab[] = [];
  let activeId: string | null = null;
  let listeners: TabListener[] = [];

  const indexOf = (id: string): number => tabs.findIndex((tab) => tab.id === id);

  const list = (): Tab[] => tabs.slice();

  const get = (id: string): Tab | null => {
    const i = indexOf(id);
    return i === -1 ? null : tabs[i];
  };

  function notify(): void {
    const snapshot = list();
    // Um listener quebrado não pode impedir os demais de atualizarem a UI.
    for (const listener of listeners) {
      try {
        listener(snapshot, activeId);
      } catch (err) {
        console.error('listener de abas falhou:', err);
      }
    }
  }

  function open(input: TabInput): Tab {
    const existente = indexOf(input.id);
    if (existente !== -1) {
      // Já aberta: foca, preservando o estado (conteúdo, dirty, cursor).
      activeId = input.id;
      notify();
      return tabs[existente];
    }

    const aba: Tab = {
      id: input.id,
      type: input.type,
      title: input.title,
      icon: input.icon,
      dirty: input.dirty === true,
      meta: input.meta ?? {},
    };
    tabs = [...tabs, aba];
    activeId = aba.id;
    notify();
    return aba;
  }

  function close(id: string): void {
    const i = indexOf(id);
    if (i === -1) return;

    const fechandoAtiva = activeId === id;
    tabs = [...tabs.slice(0, i), ...tabs.slice(i + 1)];

    if (fechandoAtiva) {
      // Vizinha à direita; se não houver, a da esquerda; se não houver, nenhuma.
      const proxima = tabs[i] ?? tabs[i - 1] ?? null;
      activeId = proxima === null ? null : proxima.id;
    }
    notify();
  }

  function activate(id: string): void {
    if (indexOf(id) === -1 || activeId === id) return;
    activeId = id;
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
    activeId: () => activeId,
    active: () => (activeId === null ? null : get(activeId)),
    open,
    close,
    activate,
    update,
    onChange,
  };
}
