// Guarda e devolve as abas do editor entre uma sessão e outra (spec 030).
//
// A spec 023 já devolvia os terminais do painel depois do F5; as abas do editor
// continuavam sumindo, e recarregar a página custava reabrir tudo à mão.
//
// Mora no `localStorage`, e não no servidor, pelo mesmo critério da largura da
// lateral e da altura do painel: é **arranjo de tela**, muda a cada clique, e um
// ida-e-volta ao servidor por aba aberta seria desproporcional.
import { useEffect, useRef } from 'react';
import { usePersistido } from './usePersistido';
import { montarSessao, normalizarSessao, SESSAO_VAZIA } from '../shared/sessao-abas';
import type { Workspace } from './useWorkspace';

export interface SessaoDeAbasDeps {
  readonly ws: Workspace;
  /** Caminho da pasta aberta; `''` enquanto nenhuma está. */
  readonly pasta: string;
  readonly aoFalhar: (erro: unknown) => void;
}

export function useSessaoDeAbas({ ws, pasta, aoFalhar }: SessaoDeAbasDeps): void {
  const [guardada, guardar] = usePersistido('sessao-abas', SESSAO_VAZIA, normalizarSessao);

  // O que estava no disco quando a página abriu. Uma ref porque o valor MUDA
  // assim que a primeira aba é gravada, e a restauração precisa do original.
  const original = useRef(guardada);
  const restaurado = useRef(false);
  /**
   * O último desenho gravado.
   *
   * **Sem isto há laço de renderização.** Gravar é estado, e a sessão é montada
   * a cada render: um objeto novo por render faz o efeito gravar, gravar
   * re-renderiza, e o ciclo não para. Medido antes do conserto: **330 escritas
   * por segundo**, e nenhum erro na tela — a IDE só ficava sem responder a
   * cliques, porque o React nunca alcançava o repouso.
   */
  const ultimo = useRef('');

  useEffect(() => {
    if (restaurado.current || pasta === '') return;
    restaurado.current = true;
    // Pasta diferente da que gerou a sessão: as abas de um projeto não podem
    // reaparecer noutro. Não é erro — é o caso normal de trocar de projeto.
    if (original.current.pasta !== pasta) return;
    ws.restaurarSessao(original.current).catch(aoFalhar);
    // `ws` fora das dependências: ele muda a cada render, e restaurar duas
    // vezes reabriria as abas por cima das que já estão na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasta]);

  useEffect(() => {
    if (!restaurado.current || pasta === '') return;

    // Só aba de ARQUIVO: aba sem título não tem caminho, e aba de query ou
    // terminal é vista de uma conexão viva — ressuscitá-la sem a conexão daria
    // uma aba que não faz nada.
    const abas = ws.tabs
      .filter((t) => t.id.startsWith('file:'))
      .map((t) => ({ caminho: t.id.slice('file:'.length), grupo: t.grupo }));

    const ativas: Record<string, string> = {};
    for (const grupo of ws.grupos) {
      const id = ws.store.ativaDoGrupo(grupo);
      if (id !== null && id.startsWith('file:')) ativas[grupo] = id.slice('file:'.length);
    }

    const sessao = montarSessao({
      pasta, abas, ativas, grupoFocado: ws.grupoFocado, layout: ws.layout,
    });
    const desenho = JSON.stringify(sessao);
    if (desenho === ultimo.current) return;
    ultimo.current = desenho;
    guardar(sessao);
  }, [guardar, pasta, ws.grupoFocado, ws.grupos, ws.layout, ws.store, ws.tabs]);
}
