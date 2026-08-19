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
  readonly resultado: ResultadoDaBusca;
  readonly carregando: boolean;
  /** A expressão do usuário não compila — o campo fica vermelho, sem diálogo. */
  readonly termoInvalido: boolean;
  definirTermo(valor: string): void;
  definirSubstituto(valor: string): void;
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
  const [resultado, setResultado] = useState<ResultadoDaBusca>(VAZIO);
  const [carregando, setCarregando] = useState(false);

  // A busca em curso: uma resposta velha não pode sobrescrever uma nova. Sem
  // isto, digitar depressa deixa na tela o resultado de um termo que já mudou.
  const geracao = useRef(0);

  const termoInvalido = termo.trim() !== '' && montarRegex(termo, opcoes) === null;

  const procurar = useCallback(
    async (alvo: string, comQuais: OpcoesDeBusca): Promise<void> => {
      const minha = (geracao.current += 1);
      if (alvo.trim() === '') {
        setResultado(VAZIO);
        setCarregando(false);
        return;
      }
      setCarregando(true);
      try {
        const r = await Api.search(alvo, comQuais);
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
      procurar(termo, opcoes).catch(aoFalhar);
    }, ATRASO_MS);
    return () => window.clearTimeout(t);
    // `aoFalhar` fora das dependências: é recriado a cada render e reiniciaria
    // o temporizador sem parar.
  }, [termo, opcoes, termoInvalido, procurar]);

  return {
    termo,
    substituto,
    opcoes,
    resultado,
    carregando,
    termoInvalido,
    definirTermo: setTermo,
    definirSubstituto: setSubstituto,
    alternarOpcao: (qual) => setOpcoes((atual) => ({ ...atual, [qual]: !atual[qual] })),
    recarregar: () => procurar(termo, opcoes),
    substituir: async (caminhos) => {
      await Api.replaceInFiles(termo, opcoes, substituto, caminhos);
      // Antes de refazer a busca: o que está aberto no editor ficou velho no
      // mesmo instante em que o disco mudou.
      await aposSubstituir(caminhos);
      // Refaz a busca: depois de trocar, o resultado antigo aponta para texto
      // que não existe mais, e clicar nele levaria à linha errada.
      await procurar(termo, opcoes);
    },
  };
}
