// Liga o store de abas ao React.
//
// O store é assinado por `onChange` e o resultado guardado em estado local. Não
// se usa `useSyncExternalStore` de propósito: `list()` devolve um array novo a
// cada chamada, e o snapshot instável faria o React entrar em laço. O listener
// já entrega o array pronto, então guardá-lo resolve sem truque.
import { useEffect, useMemo, useState } from 'react';
import { createTabStore, type Tab, type TabStore } from '../../shared/tabs';

export interface TabsEstado {
  readonly store: TabStore;
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly active: Tab | null;
  /** Números dos grupos que existem agora, em ordem. */
  readonly grupos: readonly number[];
  readonly grupoFocado: number;
}

export function useTabs(): TabsEstado {
  const store = useMemo(() => createTabStore(), []);
  const [estado, setEstado] = useState<{ tabs: readonly Tab[]; activeId: string | null }>(() => ({
    tabs: store.list(),
    activeId: store.activeId(),
  }));

  useEffect(() => store.onChange((tabs, activeId) => setEstado({ tabs, activeId })), [store]);

  const active = estado.activeId === null ? null : (store.get(estado.activeId) ?? null);
  // Derivados das abas, e não guardados: um estado paralelo poderia divergir do
  // store, e a divisão da tela é justamente o que não pode piscar errado.
  return {
    store,
    tabs: estado.tabs,
    activeId: estado.activeId,
    active,
    grupos: store.grupos(),
    grupoFocado: store.grupoFocado(),
  };
}
