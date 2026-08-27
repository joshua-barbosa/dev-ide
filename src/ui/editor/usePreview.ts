// Qual aba está mostrando o conteúdo RENDERIZADO (specs 068 e 069).
//
// Saiu de `useWorkspace.ts` quando ele passou do teto de 800 linhas do Artigo
// IV ao ganhar o diagrama ER. É um corte natural: aqui está tudo que sabe o que
// é "preview", e lá o que sabe o que é uma aba.
import { useCallback, useState } from 'react';

export interface Preview {
  /** Ids das abas que estão mostrando o renderizado, e não o texto. */
  readonly emPreview: ReadonlySet<string>;
  alternarPreview(): void;
  /**
   * Abre um markdown JÁ em preview — hoje, o diagrama ER (T064).
   *
   * O texto continua atrás do switch: quem quiser lê a fonte, edita e grava no
   * repositório como documentação. Uma tela só de visualização daria menos.
   */
  abrirRenderizado(id: string, titulo: string, conteudo: string): void;
}

export interface DepsDoPreview {
  abrirTexto(id: string, titulo: string, conteudo: string, linguagem: string): void;
  /** Id da aba ativa, ou `null`. */
  idAtivo(): string | null;
  /**
   * Grava o editor no store ANTES de trocar.
   *
   * O preview precisa mostrar o que está na TELA, inclusive o que ainda não foi
   * salvo em disco. Sem isto, o switch mostraria a versão de antes da última
   * tecla — e o usuário concluiria que o preview está quebrado.
   */
  salvarGrupoFocado(): void;
}

export function usePreview(deps: DepsDoPreview): Preview {
  const { abrirTexto, idAtivo, salvarGrupoFocado } = deps;
  const [emPreview, setEmPreview] = useState<ReadonlySet<string>>(new Set());

  const abrirRenderizado = useCallback(
    (id: string, titulo: string, conteudo: string) => {
      abrirTexto(id, titulo, conteudo, 'markdown');
      setEmPreview((atual) => new Set(atual).add(id));
    },
    [abrirTexto]
  );

  const alternarPreview = useCallback(() => {
    const id = idAtivo();
    if (id === null) return;
    salvarGrupoFocado();
    setEmPreview((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }, [idAtivo, salvarGrupoFocado]);

  return { emPreview, alternarPreview, abrirRenderizado };
}
