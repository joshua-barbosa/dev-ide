// Os snippets, do lado da interface.
//
// Guarda a lista e recarrega ao criar ou remover — a lista de conclusão do
// editor lê daqui, e ela precisa refletir o que acabou de ser salvo.
import { useCallback, useEffect, useState } from 'react';
import { Api } from './api';
import type { Snippet } from '../shared/snippets';

export interface Snippets {
  readonly lista: readonly Snippet[];
  recarregar(): Promise<void>;
  criar(dados: Omit<Snippet, 'id'>): Promise<void>;
  remover(id: string): Promise<void>;
}

export function useSnippets(aoFalhar: (erro: unknown) => void): Snippets {
  const [lista, setLista] = useState<readonly Snippet[]>([]);

  const recarregar = useCallback(async () => {
    setLista(await Api.snippets());
  }, []);

  useEffect(() => {
    // Snippet que não carrega não pode travar a IDE: fica sem sugestão.
    recarregar().catch(aoFalhar);
  }, [recarregar]);

  return {
    lista,
    recarregar,
    criar: async (dados) => {
      await Api.createSnippet(dados);
      await recarregar();
    },
    remover: async (id) => {
      await Api.deleteSnippet(id);
      await recarregar();
    },
  };
}
