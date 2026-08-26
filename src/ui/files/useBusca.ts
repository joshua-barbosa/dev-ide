// Estado da busca em arquivos.
//
// A varredura é do servidor e a decisão do que casa é de `shared/busca.ts`.
// Aqui fica o que é do React — e o **atraso**, que é a diferença entre uma busca
// usável e uma requisição por tecla digitada.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import { montarRegex, OPCOES_PADRAO, type OpcoesDeBusca } from '../../shared/busca';
import type { ResultadoDaBusca } from '../api';

/**
 * Espera antes de procurar.
 *
 * Curto o bastante para parecer imediato, longo o bastante para "cliente" não
 * virar oito varreduras da pasta inteira.
 */
const ATRASO_MS = 300;

const VAZIO: ResultadoDaBusca = {
  arquivos: [],
  totalDeOcorrencias: 0,
  truncado: false,
  arquivosVisitados: 0,
};

export interface Busca {
  readonly termo: string;
  readonly substituto: string;
  readonly opcoes: OpcoesDeBusca;
  /** Padrões separados por vírgula, como no VS Code (T031). Vazio = tudo. */
  readonly incluir: string;
  readonly excluir: string;
  /**
   * A última substituição que ainda dá para desfazer (T032), ou `null`.
   *
   * Vive no servidor, em memória — recarregar a IDE zera, como o desfazer de
   * qualquer editor.
   */
  readonly desfazivel: { readonly id: string; readonly arquivos: number } | null;
  readonly resultado: ResultadoDaBusca;
  readonly carregando: boolean;
  /** A expressão do usuário não compila — o campo fica vermelho, sem diálogo. */
  readonly termoInvalido: boolean;
  definirTermo(valor: string): void;
  definirSubstituto(valor: string): void;
  definirIncluir(valor: string): void;
  definirExcluir(valor: string): void;
  /** Desfaz a última substituição. */
  desfazer(): Promise<void>;
  alternarOpcao(qual: keyof OpcoesDeBusca): void;
  /** Refaz a busca agora, sem esperar o atraso. */
  recarregar(): Promise<void>;
  substituir(caminhos: readonly string[]): Promise<void>;
}

/**
 * @param aposSubstituir Recebe os caminhos reescritos. É o gancho que reabre as
 *   abas afetadas — ver `recarregarDoDisco` em `useWorkspace`.
 */
export function useBusca(
  aoFalhar: (erro: unknown) => void,
  aposSubstituir: (caminhos: readonly string[]) => Promise<void>
): Busca {
  const [termo, setTermo] = useState('');
  const [substituto, setSubstituto] = useState('');
  const [opcoes, setOpcoes] = useState<OpcoesDeBusca>(OPCOES_PADRAO);
  const [incluir, setIncluir] = useState('');
  const [excluir, setExcluir] = useState('');
  const [desfazivel, setDesfazivel] = useState<Busca['desfazivel']>(null);
  const [resultado, setResultado] = useState<ResultadoDaBusca>(VAZIO);
  const [carregando, setCarregando] = useState(false);

  // A busca em curso: uma resposta velha não pode sobrescrever uma nova. Sem
  // isto, digitar depressa deixa na tela o resultado de um termo que já mudou.
  const geracao = useRef(0);

  const termoInvalido = termo.trim() !== '' && montarRegex(termo, opcoes) === null;

  const procurar = useCallback(
    async (
      alvo: string,
      comQuais: OpcoesDeBusca,
      filtros: { readonly incluir: string; readonly excluir: string }
    ): Promise<void> => {
      const minha = (geracao.current += 1);
      if (alvo.trim() === '') {
        setResultado(VAZIO);
        setCarregando(false);
        return;
      }
      setCarregando(true);
      try {
        const r = await Api.search(alvo, comQuais, filtros);
        if (geracao.current === minha) setResultado(r);
      } finally {
        if (geracao.current === minha) setCarregando(false);
      }
    },
    []
  );

  // Procura sozinho enquanto se digita, com atraso.
  useEffect(() => {
    if (termoInvalido) return;
    const t = window.setTimeout(() => {
      procurar(termo, opcoes, { incluir, excluir }).catch(aoFalhar);
    }, ATRASO_MS);
    return () => window.clearTimeout(t);
    // `aoFalhar` fora das dependências: é recriado a cada render e reiniciaria
    // o temporizador sem parar.
  }, [termo, opcoes, incluir, excluir, termoInvalido, procurar]);

  return {
    termo,
    substituto,
    opcoes,
    resultado,
    carregando,
    termoInvalido,
    incluir,
    excluir,
    desfazivel,
    definirTermo: setTermo,
    definirSubstituto: setSubstituto,
    definirIncluir: setIncluir,
    definirExcluir: setExcluir,
    alternarOpcao: (qual) => setOpcoes((atual) => ({ ...atual, [qual]: !atual[qual] })),
    recarregar: () => procurar(termo, opcoes, { incluir, excluir }),
    substituir: async (caminhos) => {
      const r = await Api.replaceInFiles(termo, opcoes, substituto, caminhos);
      // O desfazer (T032) fica disponível na hora: é "errei agora e quero
      // voltar", e oferecer isso dez segundos depois seria tarde.
      setDesfazivel(r.desfazer === null ? null : { id: r.desfazer, arquivos: caminhos.length });
      // Antes de refazer a busca: o que está aberto no editor ficou velho no
      // mesmo instante em que o disco mudou.
      await aposSubstituir(caminhos);
      // Refaz a busca: depois de trocar, o resultado antigo aponta para texto
      // que não existe mais, e clicar nele levaria à linha errada.
      await procurar(termo, opcoes, { incluir, excluir });
    },
    desfazer: async () => {
      if (desfazivel === null) return;
      const r = await Api.undoReplace(desfazivel.id);
      setDesfazivel(null);
      // Os arquivos voltaram ao que eram: as abas abertas precisam saber.
      await aposSubstituir([...r.restauradosCaminhos]);
      await procurar(termo, opcoes, { incluir, excluir });
    },
  };
}
