// O arranjo dos grupos de editor: dividir, redimensionar e reconciliar.
//
// Saiu de `useWorkspace.ts` quando ele passou do teto de 800 linhas do Artigo IV
// ao ganhar a proporção arrastável (T021). É um corte natural: aqui está o que
// sabe o que é um ARRANJO, e lá o que sabe o que é uma aba.
//
// A política — onde o grupo novo entra, o que colapsa, qual o mínimo de uma
// fatia — continua no módulo puro `shared/layout-editor.ts`, testada sem
// navegador. Isto aqui é só o estado e a reconciliação com o store de abas.
import { useCallback, useEffect, useState } from 'react';
import {
  dividir as dividirLayout,
  LAYOUT_INICIAL,
  normalizarLayout,
  podeDividir,
  proximoGrupo,
  redimensionar,
  type Lado,
  type NoDeLayout,
} from '../../shared/layout-editor';
import { GRUPO_PADRAO, type Tab, type TabStore } from '../../shared/tabs';

export interface LayoutDeGrupos {
  readonly layout: NoDeLayout;
  /**
   * Troca o arranjo inteiro.
   *
   * Aceita a forma de atualizador do React porque quem solta uma aba num lado
   * precisa ler o arranjo ATUAL para decidir — e ler do render seria decidir
   * com o arranjo de antes do último arraste.
   */
  definirLayout: React.Dispatch<React.SetStateAction<NoDeLayout>>;
  /** Manda a aba ativa para um grupo novo, do lado pedido. */
  dividir(lado: Lado): void;
  /** Move a fronteira entre dois irmãos (T021). */
  redimensionarLayout(caminho: readonly number[], indice: number, fracao: number): void;
}

export interface DepsDoLayout {
  readonly store: TabStore;
  readonly tabs: readonly Tab[];
  readonly grupoFocado: number;
  /** Grava o conteúdo dos editores antes de mexer no arranjo. */
  salvarTodosOsGrupos(): void;
}

export function useLayoutDeGrupos(deps: DepsDoLayout): LayoutDeGrupos {
  const { store, tabs, grupoFocado, salvarTodosOsGrupos } = deps;
  const [layout, setLayout] = useState<NoDeLayout>(LAYOUT_INICIAL);

  /**
   * Descarta do arranjo os grupos que não têm mais aba.
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

  const dividir = useCallback(
    (lado: Lado) => {
      const id = store.activeId();
      if (id === null) return;
      salvarTodosOsGrupos();
      const alvo = store.get(id)?.grupo ?? GRUPO_PADRAO;
      setLayout((atual) => {
        if (!podeDividir(atual)) return atual;
        const novo = proximoGrupo(atual);
        store.mover(id, novo);
        return dividirLayout(atual, alvo, lado, novo);
      });
    },
    [salvarTodosOsGrupos, store]
  );

  /**
   * Move uma fronteira do arranjo (T021).
   *
   * A proporção mora no LAYOUT, que já vai para a sessão — então ela sobrevive
   * ao F5 sem nenhum lugar novo para guardar.
   */
  const redimensionarLayout = useCallback(
    (caminho: readonly number[], indice: number, fracao: number) => {
      setLayout((atual) => redimensionar(atual, caminho, indice, fracao));
    },
    []
  );

  return { layout, definirLayout: setLayout, dividir, redimensionarLayout };
}
