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
  /**
   * O SQL no topo da aba, editável (spec 043).
   *
   * No modo tabela ele é ESPELHO do que a IDE montou, e se reescreve a cada
   * ordenação, filtro ou página. No modo livre é o que o usuário digitou.
   */
  readonly sql: string;
  /** O usuário mexeu no SQL: paginação, ordem e filtro saem de cena. */
  readonly modoLivre: boolean;
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
  /**
   * Interrompe a consulta em andamento (T005).
   *
   * `null` quando o banco não sabe fazer — o SQLite não sabe, porque
   * `node:sqlite` é síncrono e enquanto a consulta roda não há segundo instante
   * para mandar nada. Botão que não para é pior que botão ausente.
   */
  readonly parar: (() => void) | null;
  definirSql(texto: string): void;
  /** Roda o SQL do topo. Entra em modo livre se ele foi editado. */
  executarSql(): void;
  /** Volta ao SQL montado, e com ele aos controles. */
  voltarParaTabela(): void;
}

export interface DepsDaTabela {
  readonly connectionId: string;
  readonly nodePath: readonly string[];
  /** Contra qual database rodar o SQL livre (spec 038). */
  readonly database: string | null;
}

export function useTabela({ connectionId, nodePath, database }: DepsDaTabela): EstadoDaTabela {
  const [pagina, setPagina] = useState<TablePage | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [numero, setNumero] = useState(1);
  const [porPagina, setPorPagina] = useState(PADRAO_POR_PAGINA);
  const [ordenar, setOrdenar] = useState<OrdenacaoDeTabela | null>(null);
  const [filtros, setFiltros] = useState<Readonly<Record<string, string>>>({});
  const [versao, setVersao] = useState(0);

  // O SQL do topo. `null` = ainda não foi tocado, e o espelho manda.
  const [sqlEditado, setSqlEditado] = useState<string | null>(null);
  const [livre, setLivre] = useState<{ readonly sql: string } | null>(null);
  const [resultadoLivre, setResultadoLivre] = useState<TablePage | null>(null);

  // O banco sabe cancelar? Perguntado uma vez por conexão, ao montar a aba.
  const [cancela, setCancela] = useState(false);
  useEffect(() => {
    let vigente = true;
    // `connect` é o que a IDE já chama ao abrir a conexão, e é ele que devolve
    // o que a sessão declara. Perguntar por uma rota própria criaria uma
    // segunda fonte para a mesma verdade.
    void Api.connect(connectionId)
      .then((c) => {
        if (vigente) setCancela(c.cancelaQuery);
      })
      // Falhar aqui só esconde o botão, e esconder é o lado seguro.
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [connectionId]);

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

  // ---- Modo LIVRE: o SQL que o usuário escreveu ----
  useEffect(() => {
    if (livre === null) return;
    const minha = (geracao.current += 1);
    setCarregando(true);
    Api.execute(connectionId, { statement: livre.sql, database: database ?? undefined })
      .then((resultado) => {
        if (geracao.current !== minha) return;
        // Sem colunas com chave: quem não sabe a tabela não sabe a chave.
        setResultadoLivre({
          resultado,
          columns: resultado.columns.map((c) => ({
            name: c.name, type: c.type, chave: false, obrigatoria: false,
          })),
          total: null,
          totalEstimado: null,
          sql: livre.sql,
        });
        setErro(null);
      })
      .catch((e: Error) => {
        if (geracao.current !== minha) return;
        // O texto digitado NÃO se perde: só o resultado (AC-6).
        setErro(e.message);
      })
      .finally(() => {
        if (geracao.current === minha) setCarregando(false);
      });
  }, [connectionId, database, livre]);

  // ---- Modo TABELA: a IDE monta a consulta ----
  useEffect(() => {
    if (livre !== null) return;
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
  }, [connectionId, caminho, numero, porPagina, ordenar, filtros, versao, livre]);

  /** Mudar o conjunto volta para a primeira página: a 40 pode não existir mais. */
  const doInicio = useCallback((fn: () => void) => {
    fn();
    setNumero(1);
  }, []);

  // No modo tabela o SQL do topo é ESPELHO: reescrevê-lo a cada mudança é o que
  // impede o campo de mentir sobre o que rodou.
  const emUso = livre === null ? pagina : resultadoLivre;
  const sql = sqlEditado ?? emUso?.sql ?? '';

  const total = emUso?.total ?? null;
  const totalDePaginas = total === null ? null : Math.max(1, Math.ceil(total / porPagina));

  return {
    pagina: emUso,
    sql,
    modoLivre: livre !== null,
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

    parar:
      cancela && carregando
        ? () => {
            // O erro do cancelamento não pode apagar o erro DA QUERY, que é o
            // que o usuário precisa ler. Vai para o mesmo campo só quando não
            // há nada lá.
            void Api.cancelQuery(connectionId).catch((e: Error) => {
              setErro((atual) => atual ?? `Não deu para parar: ${e.message}`);
            });
          }
        : null,

    definirSql: (texto: string) => setSqlEditado(texto),

    executarSql: () => {
      const texto = (sqlEditado ?? sql).trim();
      if (texto === '') return;
      // Igual ao que a IDE montou? Então não é edição — é o mesmo SQL, e os
      // controles continuam valendo. Evita cair no modo livre por um clique.
      if (livre === null && pagina !== null && texto === pagina.sql.trim()) {
        setSqlEditado(null);
        setVersao((v) => v + 1);
        return;
      }
      setLivre({ sql: texto });
    },

    voltarParaTabela: () => {
      setLivre(null);
      setResultadoLivre(null);
      setSqlEditado(null);
      setErro(null);
    },
  };
}
