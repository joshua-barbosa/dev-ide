// Layout da moldura: o que está visível e de que tamanho.
//
// Junto num lugar só porque os três se influenciam — esconder o painel muda a
// altura disponível para o editor, e a barra de status precisa saber dos dois
// para desenhar os botões no estado certo.
import { useCallback } from 'react';
import { usePersistido } from './usePersistido';
import { type AbaDoPainel, ehAbaDoPainel } from '../shared/painel';

export const ALTURA_MIN_PAINEL = 80;
export const ALTURA_PADRAO_PAINEL = 200;
/** Espaço mínimo que sobra para o editor — a mesma reserva que a lateral tem. */
const RESERVA_EDITOR = 200;

export interface Layout {
  readonly lateralVisivel: boolean;
  readonly painelVisivel: boolean;
  readonly alturaDoPainel: number;
  readonly abaDoPainel: AbaDoPainel;
  alternarLateral(): void;
  alternarPainel(): void;
  /** Mostra o painel já na aba pedida — usado quando chega saída ou erro. */
  mostrarPainel(aba: AbaDoPainel): void;
  definirAba(aba: AbaDoPainel): void;
  definirAltura(altura: number): void;
}

export function limitarAltura(altura: number, alturaDaJanela: number): number {
  const maximo = Math.max(ALTURA_MIN_PAINEL, alturaDaJanela - RESERVA_EDITOR);
  return Math.min(Math.max(altura, ALTURA_MIN_PAINEL), maximo);
}

export function useLayout(): Layout {
  const [lateralVisivel, setLateral] = usePersistido('lateral-visivel', true);
  const [painelVisivel, setPainel] = usePersistido('painel-visivel', true);
  const [altura, setAltura] = usePersistido('painel-altura', ALTURA_PADRAO_PAINEL);
  const [aba, setAba] = usePersistido<string>('painel-aba', 'output');

  const definirAba = useCallback((nova: AbaDoPainel) => setAba(nova), [setAba]);

  const mostrarPainel = useCallback(
    (nova: AbaDoPainel) => {
      setAba(nova);
      setPainel(true);
    },
    [setAba, setPainel]
  );

  return {
    lateralVisivel,
    painelVisivel,
    alturaDoPainel: altura,
    // Aba guardada de uma versão anterior pode não existir mais; cai no padrão
    // em vez de deixar o painel em branco.
    abaDoPainel: ehAbaDoPainel(aba) ? aba : 'output',
    alternarLateral: () => setLateral((v) => !v),
    alternarPainel: () => setPainel((v) => !v),
    mostrarPainel,
    definirAba,
    definirAltura: (nova: number) => setAltura(limitarAltura(nova, window.innerHeight)),
  };
}
