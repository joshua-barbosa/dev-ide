// Guarda e devolve as abas do editor entre uma sessão e outra (spec 030).
//
// A spec 023 já devolvia os terminais do painel depois do F5; as abas do editor
// continuavam sumindo, e recarregar a página custava reabrir tudo à mão.
//
// Mora no `localStorage`, e não no servidor, pelo mesmo critério da largura da
// lateral e da altura do painel: é **arranjo de tela**, muda a cada clique, e um
// ida-e-volta ao servidor por aba aberta seria desproporcional.
import { useCallback, useEffect, useRef } from 'react';
import { usePersistido } from './usePersistido';
import {
  montarSessao, normalizarSessao, SESSAO_VAZIA,
  type AbaSalva, type SessaoDeAbas, type VistaSalva,
} from '../shared/sessao-abas';
import { idBaseDe } from '../shared/abas-gemeas';
import type { Workspace } from './useWorkspace';

export interface SessaoDeAbasDeps {
  readonly ws: Workspace;
  /** Caminho da pasta aberta; `''` enquanto nenhuma está. */
  readonly pasta: string;
  readonly aoFalhar: (erro: unknown) => void;
}

export function useSessaoDeAbas({ ws, pasta, aoFalhar }: SessaoDeAbasDeps): void {
  const [guardada, guardar, guardarJa] = usePersistido('sessao-abas', SESSAO_VAZIA, normalizarSessao);

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

  /**
   * A sessão a partir do STORE, e não do espelho do React.
   *
   * A diferença importa no `pagehide`: lá o store acabou de receber a posição
   * do cursor, e `ws.tabs` só vira o valor novo no próximo render — que não
   * acontece, porque a página está indo embora.
   */
  const montarAgora = useCallback((): SessaoDeAbas | null => {
    if (pasta === '') return null;

    // Só aba de ARQUIVO: aba sem título não tem caminho, e aba de query ou
    // terminal é vista de uma conexão viva — ressuscitá-la sem a conexão daria
    // uma aba que não faz nada.
    //
    // `idBaseDe` e não o id cru: a segunda vista do mesmo arquivo (T028) se
    // chama `copia:2:file:…`, e filtrar pelo prefixo `file:` a deixaria de fora.
    const caminhoDe = (id: string): string | null => {
      const base = idBaseDe(id);
      return base.startsWith('file:') ? base.slice('file:'.length) : null;
    };

    const abas: AbaSalva[] = [];
    for (const t of ws.store.list()) {
      const caminho = caminhoDe(t.id);
      if (caminho === null) continue;
      // Cursor e rolagem (T036), vindos do `meta` — atualizado ao trocar de aba
      // e no `pagehide`.
      const view = (t.meta as { view?: VistaSalva | null }).view ?? null;
      abas.push({ caminho, grupo: t.grupo, ...(view === null ? {} : { view }) });
    }

    const ativas: Record<string, string> = {};
    for (const grupo of ws.store.grupos()) {
      const id = ws.store.ativaDoGrupo(grupo);
      const caminho = id === null ? null : caminhoDe(id);
      if (caminho !== null) ativas[grupo] = caminho;
    }

    return montarSessao({
      pasta,
      abas,
      ativas,
      grupoFocado: ws.store.grupoFocado(),
      layout: ws.layout,
    });
  }, [pasta, ws.layout, ws.store]);

  /**
   * Grava, se o desenho mudou desde a última vez.
   *
   * `agora` escreve no `localStorage` na hora, em vez de por dentro do
   * atualizador do `setState` — é o que o `pagehide` precisa, porque ali não
   * existe próximo render.
   */
  const gravarSeMudou = useCallback(
    (agora = false) => {
      const sessao = montarAgora();
      if (sessao === null) return;
      const desenho = JSON.stringify(sessao);
      if (desenho === ultimo.current) return;
      ultimo.current = desenho;
      if (agora) guardarJa(sessao);
      else guardar(sessao);
    },
    [guardar, guardarJa, montarAgora]
  );

  useEffect(() => {
    if (!restaurado.current || pasta === '') return;
    gravarSeMudou();
  }, [gravarSeMudou, pasta, ws.grupoFocado, ws.grupos, ws.layout, ws.tabs]);

  /**
   * Antes de a página sumir, descarrega os editores para o store (T036).
   *
   * O `meta.view` só é atualizado ao TROCAR de aba — a aba em foco na hora do
   * F5 guardaria a posição de quando ela foi aberta. Aqui não há laço a temer:
   * a página está indo embora, e ninguém re-renderiza depois.
   *
   * `pagehide` e não `beforeunload`: o segundo é o que abre a caixa de "sair
   * mesmo?" em alguns navegadores, e isto não quer perguntar nada.
   */
  const salvarTudo = ws.salvarTodosOsGrupos;
  useEffect(() => {
    const aoSair = (): void => {
      salvarTudo();
      // Grava AQUI e AGORA, e não pelo efeito: `salvarTodosOsGrupos` mexe no
      // store, e tanto o efeito que persiste quanto o `setState` que grava só
      // rodariam no próximo render — que não vem, porque a página está indo
      // embora. Foi o defeito que o teste de F5 pegou.
      gravarSeMudou(true);
    };
    window.addEventListener('pagehide', aoSair);
    return () => window.removeEventListener('pagehide', aoSair);
  }, [gravarSeMudou, salvarTudo]);
}
