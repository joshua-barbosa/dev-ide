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
import { proximaCopia } from '../../shared/abas-gemeas';

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
  /**
   * Abre uma SEGUNDA vista do arquivo ativo num grupo novo (T028).
   *
   * Diferente de `dividir`: aqui a aba original fica onde está. As duas passam
   * a mostrar o mesmo arquivo, com o mesmo texto — quem garante isso é o modelo
   * compartilhado do Monaco (ver `editor/modelos.ts`).
   */
  duplicar(lado: Lado): void;
  /**
   * Abre uma aba NOVA no grupo ao lado, dividindo a tela se preciso (spec 077).
   *
   * É o que o CodeSnap pede: *"ele divide a tela — na esquerda o código que
   * havia selecionado e na direita o preview da imagem"*. A aba de origem fica
   * onde está, e por isso ele continua selecionando texto nela.
   *
   * Já dividido, a aba vai para um grupo que já existe em vez de recusar: com
   * a tela dividida ao meio, "não dá para dividir mais" não é resposta útil
   * para quem só quer ver a foto ao lado.
   */
  abrirAoLado(aba: Omit<Tab, 'grupo'>, lado?: Lado): void;
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

  const duplicar = useCallback(
    (lado: Lado) => {
      const id = store.activeId();
      if (id === null) return;
      const aba = store.get(id);
      if (aba === null) return;
      salvarTodosOsGrupos();
      const alvo = aba.grupo;
      setLayout((atual) => {
        if (!podeDividir(atual)) return atual;
        const novo = proximoGrupo(atual);
        // A cópia nasce com o `meta` da original, inclusive a vista: abrir do
        // lado direito na linha 1 quando se estava na linha 400 seria perder o
        // lugar justamente no gesto que existe para comparar dois pontos.
        store.open({ ...aba, id: proximaCopia(store.list().map((t) => t.id), aba.id), grupo: novo });
        return dividirLayout(atual, alvo, lado, novo);
      });
    },
    [salvarTodosOsGrupos, store]
  );

  const abrirAoLado = useCallback(
    (nova: Omit<Tab, 'grupo'>, lado: Lado = 'direita') => {
      const id = store.activeId();
      const alvo = id === null ? GRUPO_PADRAO : (store.get(id)?.grupo ?? GRUPO_PADRAO);
      salvarTodosOsGrupos();
      setLayout((atual) => {
        if (!podeDividir(atual)) {
          // Sem espaço para outro grupo: usa um que já exista, e só cai no
          // próprio quando não há nenhum outro.
          const outros = store
            .list()
            .map((t) => t.grupo)
            .filter((g) => g !== alvo);
          store.open({ ...nova, grupo: outros[0] ?? alvo });
          return atual;
        }
        const novo = proximoGrupo(atual);
        store.open({ ...nova, grupo: novo });
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

  return {
    layout, definirLayout: setLayout, dividir, duplicar, abrirAoLado, redimensionarLayout,
  };
}
