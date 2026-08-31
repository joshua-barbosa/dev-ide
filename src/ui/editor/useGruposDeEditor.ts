// Os editores da tela, um por grupo.
//
// Saiu de `useWorkspace` quando ele passou do teto de 800 linhas do Artigo IV.
// O corte não é arbitrário: aqui mora tudo que sabe que existe **mais de um
// editor** — o mapa de instâncias, a guarda de reentrância por grupo, o efeito
// que carrega a aba ativa de cada um e as três formas de descarregar o que está
// na tela de volta para o store.
//
// O resto do `useWorkspace` fala de ABAS, e não precisa saber disto.
//
// **Três armadilhas moram neste arquivo**, todas já custaram um defeito: marcar
// a aba como carregada antes de o editor existir, salvar usando `aba.grupo` em
// vez do grupo de quem chamou, e supor que o editor de um grupo sobrevive a uma
// mudança na forma do arranjo. Os comentários no lugar explicam cada uma.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tab, TabStore } from "../../shared/tabs";
import type { EditorHandle, ViewState } from "./EditorHost";
import type { EditorTabMeta, PonteiroDeEditor } from "../useWorkspace";
import { chaveDoModelo, gemeas } from "../../shared/abas-gemeas";

export interface Posicao {
  readonly linha: number;
  readonly coluna: number;
}

export interface GruposDeEditor {
  /** O editor do grupo em foco, ou `null`. */
  readonly editorRef: PonteiroDeEditor;
  /** Ref de callback para o `EditorHost` de um grupo se registrar. */
  registrarEditor(grupo: number): (handle: EditorHandle | null) => void;
  /** Qual grupo tem o editor cujo modelo é esta URI (spec 038). */
  grupoDaUri(uri: string): number | null;
  /** Guarda no store o que está no editor de `grupoDoEditor`. */
  salvarNaAba(id: string, grupoDoEditor: number): void;
  /** Salva no store o que está no editor do grupo em foco. */
  salvarGrupoFocado(): void;
  /** Descarrega TODOS os editores para o store. */
  salvarTodosOsGrupos(): void;
  /** O editor de um grupo, se existir. */
  editorDoGrupo(grupo: number): EditorHandle | null;
  /** A aba que está carregada num grupo agora. */
  abaCarregada(grupo: number): string | null;
  /**
   * A aba carregada no grupo em FOCO.
   *
   * Existe além de `abaCarregada` porque quem pergunta costuma ser uma closure
   * memoizada — o editor guarda o `onChange` que recebeu. Ler o foco de dentro,
   * por ref, evita que essa closure fique com um grupo velho na mão.
   */
  abaCarregadaEmFoco(): string | null;
  /** Marca para onde ir assim que a aba terminar de carregar. */
  irAoCarregar(id: string, posicao: Posicao): void;
  /**
   * Marca a vista a aplicar quando o arquivo deste CAMINHO carregar (T036).
   *
   * Por caminho, e não por id de aba: quem restaura a sessão registra ANTES de
   * abrir, porque o efeito que carrega o editor roda entre um `await` e o
   * seguinte — depois de abrir já é tarde, a aba entrou na linha 1.
   */
  vistaAoCarregar(caminho: string, vista: ViewState): void;
  /** Roda `fn` sem que a mudança conte como edição do usuário. */
  semSujar(fn: () => void): void;
  /** Verdadeiro enquanto o editor está sendo recarregado por troca de aba. */
  estaCarregando(): boolean;
}

export interface GruposDeEditorDeps {
  readonly store: TabStore;
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly grupos: readonly number[];
  readonly grupoFocado: number;
  /** Chamado quando o grupo em foco fica sem aba — o rodapé precisa saber. */
  readonly aoEsvaziarFoco: () => void;
  /**
   * Onde o cursor parou depois de carregar a aba do grupo em foco.
   *
   * O Monaco não avisa quando a posição pedida é a que já valia, e um modelo
   * novo nasce em 1,1 — sem isto a barra de status fica com a linha da aba
   * anterior ao trocar para uma que abre no começo.
   */
  readonly aoPosicionarCursor: (linha: number, coluna: number) => void;
  /** Só abas de texto têm editor; terminal e formulário não. */
  readonly ehEditavel: (aba: Tab) => boolean;
  readonly metaDe: (aba: Tab) => EditorTabMeta;
}

export function useGruposDeEditor({
  store,
  tabs,
  activeId,
  grupos,
  grupoFocado,
  aoEsvaziarFoco,
  aoPosicionarCursor,
  ehEditavel,
  metaDe,
}: GruposDeEditorDeps): GruposDeEditor {
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
    [],
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
  const refsPorGrupo = useRef(
    new Map<number, (h: EditorHandle | null) => void>(),
  );
  const grupoDaUri = useCallback((uri: string): number | null => {
    for (const [grupo, handle] of editores.current) {
      if (handle?.uriDoModelo() === uri) return grupo;
    }
    return null;
  }, []);

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

  /** Suprime o "sujou" que a própria troca de aba dispara ao recarregar o editor. */
  const carregando = useRef(false);
  /** A última aba carregada em CADA grupo — a guarda de reentrância, por grupo. */
  const ultimaAtiva = useRef(new Map<number, string | null>());
  /**
   * Para onde ir assim que a aba terminar de carregar, por id de aba.
   *
   * Abrir um arquivo e pular para uma linha são dois tempos: o conteúdo só
   * chega ao editor no efeito abaixo, um render depois. Mandar o cursor antes
   * disso não dá erro — o salto simplesmente se perde, e o arquivo abre na
   * linha 1. Era o que acontecia ao clicar num resultado de busca de um arquivo
   * ainda fechado; com ele já aberto, funcionava, e por isso passou pelo teste.
   */
  const posicaoPendente = useRef(
    new Map<string, { linha: number; coluna: number }>(),
  );

  /** Vista a aplicar quando o arquivo deste caminho carregar (T036). */
  const vistaPendente = useRef(new Map<string, ViewState>());

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
      const conteudo = editor.getValue();
      const linguagem = editor.getLanguage();
      store.update(id, {
        meta: {
          ...metaDe(aba),
          content: conteudo,
          language: linguagem,
          view: editor.getViewState(),
        },
      });

      // A gêmea recebe o TEXTO, e não a vista (T028). As duas mostram o mesmo
      // arquivo, então o conteúdo é o mesmo por definição; cursor e rolagem são
      // de cada uma, e copiá-los faria um lado saltar quando o outro rolasse.
      const irmas = gemeas(store.list().map((t) => t.id), id);
      for (const outra of irmas) {
        if (outra === id) continue;
        const alvo = store.get(outra);
        if (alvo === null) continue;
        store.update(outra, {
          meta: { ...metaDe(alvo), content: conteudo, language: linguagem },
        });
      }
    },
    [store],
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
        if (grupo === grupoFocado) aoEsvaziarFoco();
        continue;
      }
      if (editor === null || !ehEditavel(aba)) continue;

      const meta = metaDe(aba);
      carregando.current = true;
      try {
        // `usarModelo` e não `setValue` (T028): a aba pega o modelo do ARQUIVO
        // dela. Se a gêmea já o tem no outro grupo, os dois passam a mostrar o
        // mesmo texto — e `setValue` aqui apagaria o que o outro lado escreveu.
        editor.usarModelo(chaveDoModelo(aba.id, meta.path), meta.content, meta.language);
        editor.setLanguage(meta.language);
        // A vista guardada na sessão vence o `meta.view` desta abertura: a aba
        // acabou de nascer, e o `meta.view` dela é `null` por definição.
        const daSessao = meta.path === null ? undefined : vistaPendente.current.get(meta.path);
        if (daSessao !== undefined) {
          vistaPendente.current.delete(meta.path ?? '');
          editor.setViewState(daSessao);
          store.update(aba.id, { meta: { ...meta, view: daSessao } });
        } else {
          editor.setViewState(meta.view);
        }
      } finally {
        carregando.current = false;
      }

      const destino = posicaoPendente.current.get(aba.id);
      if (destino !== undefined) {
        posicaoPendente.current.delete(aba.id);
        editor.goToPosition(destino.linha, destino.coluna);
      }

      // Conta onde o cursor parou. Ver a nota em `aoPosicionarCursor`.
      if (grupo === grupoFocado) {
        const pos = editor.posicaoDoCursor();
        aoPosicionarCursor(pos.linha, pos.coluna);
      }
    }

    // Grupo que sumiu não pode deixar rastro na guarda.
    for (const grupo of [...ultimaAtiva.current.keys()]) {
      if (!grupos.includes(grupo)) ultimaAtiva.current.delete(grupo);
    }
  }, [
    activeId,
    aoEsvaziarFoco,
    aoPosicionarCursor,
    ehEditavel,
    grupoFocado,
    grupos,
    metaDe,
    salvarNaAba,
    store,
    tabs,
    versaoDosEditores,
  ]);

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
    for (const [grupo, id] of ultimaAtiva.current)
      if (id !== null) salvarNaAba(id, grupo);
  }, [salvarNaAba]);

  // Memoizado: quem consome põe este objeto em `useCallback`, e um objeto novo
  // a cada render trocaria a identidade de todas essas funções — inclusive a
  // que o editor guarda como `onChange`.
  return useMemo(
    () => ({
      editorRef,
      registrarEditor,
      salvarNaAba,
      salvarGrupoFocado,
      salvarTodosOsGrupos,
      editorDoGrupo: (grupo) => editores.current.get(grupo) ?? null,
      abaCarregada: (grupo) => ultimaAtiva.current.get(grupo) ?? null,
      abaCarregadaEmFoco: () =>
        ultimaAtiva.current.get(focoAtual.current) ?? null,
      irAoCarregar: (id, posicao) => {
        posicaoPendente.current.set(id, posicao);
      },
      vistaAoCarregar: (caminho, vista) => {
        vistaPendente.current.set(caminho, vista);
      },
      semSujar: (fn) => {
        carregando.current = true;
        try {
          fn();
        } finally {
          carregando.current = false;
        }
      },
      estaCarregando: () => carregando.current,
      grupoDaUri,
    }),
    [
      editorRef,
      grupoDaUri,
      registrarEditor,
      salvarGrupoFocado,
      salvarNaAba,
      salvarTodosOsGrupos,
    ],
  );
}
