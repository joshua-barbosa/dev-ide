// O estado de uma aba de tabela (spec 041).
//
// Página, ordenação e filtros vivem aqui; quem monta o SQL é o driver. A
// interface manda a INTENÇÃO — "ordene por esta coluna", "filtre por este
// texto" — e recebe de volta o SQL que rodou, para mostrar no topo.
//
// O contador de geração é o mesmo remédio da busca (spec 027): trocar de página
// depressa dispara pedidos que voltam fora de ordem, e sem ele a resposta velha
// sobrescreveria a nova.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import type { FiltroDeTabela, OrdenacaoDeTabela, TablePage } from '../../shared/contracts';

/** Precisa bater com `TAMANHOS_DE_PAGINA` do servidor. Há teste amarrando. */
export const TAMANHOS_DE_PAGINA: readonly number[] = [50, 100, 200, 500];
export const PADRAO_POR_PAGINA = 100;

export interface EstadoDaTabela {
  readonly pagina: TablePage | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly numero: number;
  readonly porPagina: number;
  readonly ordenar: OrdenacaoDeTabela | null;
  readonly filtros: Readonly<Record<string, string>>;
  /** Quantas páginas existem, ou `null` quando o total é só estimado. */
  readonly totalDePaginas: number | null;
  irPara(numero: number): void;
  definirPorPagina(n: number): void;
  /** Alterna crescente, decrescente e sem ordenação, nesta ordem. */
  alternarOrdem(coluna: string): void;
  definirFiltro(coluna: string, valor: string): void;
  recarregar(): void;
}

export interface DepsDaTabela {
  readonly connectionId: string;
  readonly nodePath: readonly string[];
}

export function useTabela({ connectionId, nodePath }: DepsDaTabela): EstadoDaTabela {
  const [pagina, setPagina] = useState<TablePage | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [numero, setNumero] = useState(1);
  const [porPagina, setPorPagina] = useState(PADRAO_POR_PAGINA);
  const [ordenar, setOrdenar] = useState<OrdenacaoDeTabela | null>(null);
  const [filtros, setFiltros] = useState<Readonly<Record<string, string>>>({});
  const [versao, setVersao] = useState(0);

  const geracao = useRef(0);
  // O caminho vira texto para poder entrar na lista de dependências: um vetor
  // novo a cada renderização dispararia o efeito para sempre.
  //
  // Separador NUL, e não espaço: nome de tabela e de schema podem ter espaço, e
  // um separador que aparece dentro dos pedaços não separa nada. É a mesma
  // escolha do `chaveDe` do painel de conexões. Escapado na fonte porque byte de
  // controle cru em arquivo-fonte é recusado pelo guard da spec 012.
  const SEPARADOR = '\u0000';
  const caminho = nodePath.join(SEPARADOR);

  useEffect(() => {
    const minha = (geracao.current += 1);
    setCarregando(true);
    const lista: FiltroDeTabela[] = Object.entries(filtros)
      .filter(([, valor]) => valor.trim() !== '')
      .map(([coluna, valor]) => ({ coluna, valor }));

    Api.readTable(connectionId, {
      nodePath: caminho.split(SEPARADOR),
      pagina: numero,
      porPagina,
      ordenar,
      filtros: lista,
    })
      .then((dados) => {
        // Resposta velha não pode passar por cima da nova.
        if (geracao.current !== minha) return;
        setPagina(dados);
        setErro(null);
      })
      .catch((e: Error) => {
        if (geracao.current !== minha) return;
        setErro(e.message);
      })
      .finally(() => {
        if (geracao.current === minha) setCarregando(false);
      });
  }, [connectionId, caminho, numero, porPagina, ordenar, filtros, versao]);

  /** Mudar o conjunto volta para a primeira página: a 40 pode não existir mais. */
  const doInicio = useCallback((fn: () => void) => {
    fn();
    setNumero(1);
  }, []);

  const total = pagina?.total ?? null;
  const totalDePaginas = total === null ? null : Math.max(1, Math.ceil(total / porPagina));

  return {
    pagina,
    carregando,
    erro,
    numero,
    porPagina,
    ordenar,
    filtros,
    totalDePaginas,
    irPara: (n) => setNumero(Math.max(1, n)),
    definirPorPagina: (n) => doInicio(() => setPorPagina(n)),
    alternarOrdem: (coluna) =>
      doInicio(() =>
        setOrdenar((atual) => {
          if (atual === null || atual.coluna !== coluna) return { coluna, desc: false };
          // O terceiro clique volta ao natural: a ordem do banco também é uma
          // resposta, e sem isto não haveria como voltar a ela.
          return atual.desc ? null : { coluna, desc: true };
        })
      ),
    definirFiltro: (coluna, valor) =>
      doInicio(() => setFiltros((atual) => ({ ...atual, [coluna]: valor }))),
    recarregar: () => setVersao((v) => v + 1),
  };
}
