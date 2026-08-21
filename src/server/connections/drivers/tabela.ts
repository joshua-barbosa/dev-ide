// A consulta da aba de tabela (spec 041).
//
// Monta `SELECT ... WHERE ... ORDER BY ... LIMIT ... OFFSET` e a contagem que a
// acompanha. Lógica pura: é a parte em que um erro vira injeção de SQL ou
// paginação que mente, e é testável sem nenhum banco de pé.
//
// **Duas regras que não se negociam aqui:**
//
// 1. **Nome de coluna vem da TELA.** Não dá para parametrizar identificador em
//    SQL, então a barreira é dupla: o nome tem que existir na lista de colunas
//    reais da tabela, e é citado. Uma das duas sozinha não basta — a lista sem a
//    citação quebra em nome com aspa; a citação sem a lista deixa o cliente
//    escolher coluna de outra tabela num `ORDER BY` correlacionado.
// 2. **Valor de filtro NUNCA entra no SQL.** Vai como parâmetro, sempre.
import { quoteIdentifier, type QuoteStyle } from './sql-base';

/** Tamanhos de página oferecidos, e o teto que o servidor impõe. */
export const TAMANHOS_DE_PAGINA: readonly number[] = [50, 100, 200, 500];
export const PADRAO_POR_PAGINA = 100;
export const MAX_POR_PAGINA = 1_000;

/** Estilo de marcador de parâmetro: `?` no MySQL/SQLite, `$1` no PostgreSQL. */
export type EstiloDeMarcador = 'interrogacao' | 'numerado';

export interface Ordenacao {
  readonly coluna: string;
  readonly desc: boolean;
}

export interface FiltroDeColuna {
  readonly coluna: string;
  /** Semântica de "contém". Vazio é ignorado, não vira `LIKE '%%'`. */
  readonly valor: string;
}

export interface PedidoDeTabela {
  readonly pagina: number;
  readonly porPagina: number;
  readonly ordenar: Ordenacao | null;
  readonly filtros: readonly FiltroDeColuna[];
}

export interface AlvoDeTabela {
  /** Nome já qualificado e citado. */
  readonly alvo: string;
  /** As colunas REAIS da tabela — a lista contra a qual a tela é conferida. */
  readonly colunas: readonly string[];
  readonly estilo: QuoteStyle;
  readonly marcador?: EstiloDeMarcador;
}

/**
 * O apelido da coluna de contagem.
 *
 * Constante exportada, e não texto solto, porque quem monta e quem LÊ são
 * arquivos diferentes — e foi assim que a spec 041 devolveu total `0` contra o
 * MySQL: a contagem saía sem apelido, a coluna vinha chamada `COUNT(*)`, e o
 * driver procurava por outro nome. O SQLite lia por posição e o PostgreSQL
 * apelida sozinho, então os dois disfarçaram o defeito.
 */
export const APELIDO_DA_CONTAGEM = 'total_de_linhas';

export interface ConsultaDeTabela {
  readonly sql: string;
  /** `SELECT COUNT(*)` com os MESMOS filtros — sem ele a paginação mentiria. */
  readonly contagem: string;
  readonly params: readonly string[];
}

function inteiro(bruto: unknown, padrao: number): number {
  const n = typeof bruto === 'number' ? bruto : Number(bruto);
  return Number.isFinite(n) ? Math.trunc(n) : padrao;
}

/**
 * Confere um nome de coluna contra as colunas reais.
 *
 * Comparação exata, e não normalizada: dois nomes que só diferem em caixa são
 * colunas diferentes em alguns bancos, e adivinhar qual o usuário quis dizer
 * seria escolher por ele.
 */
function exigirColuna(nome: unknown, colunas: readonly string[]): string {
  if (typeof nome !== 'string' || !colunas.includes(nome)) {
    throw new Error(`Coluna desconhecida: ${JSON.stringify(nome)}.`);
  }
  return nome;
}

/**
 * Fronteira tolerante para número, rígida para nome.
 *
 * Página e tamanho vêm de botões: um valor fora de faixa é corrigido, porque
 * devolver erro para "página 0" não ajudaria ninguém. Nome de coluna é outra
 * coisa — ali um valor inesperado é sinal de que algo está errado, e seguir
 * seria deixar o cliente escrever SQL.
 */
export function normalizarPedidoDeTabela(
  bruto: unknown,
  colunas: readonly string[]
): PedidoDeTabela {
  const r = (bruto ?? {}) as Record<string, unknown>;

  const pagina = Math.max(1, inteiro(r.pagina, 1));
  const porPagina = Math.min(MAX_POR_PAGINA, Math.max(1, inteiro(r.porPagina, PADRAO_POR_PAGINA)));

  const o = r.ordenar as Record<string, unknown> | undefined | null;
  const ordenar: Ordenacao | null =
    o === undefined || o === null
      ? null
      : { coluna: exigirColuna(o.coluna, colunas), desc: o.desc === true };

  const filtros = (Array.isArray(r.filtros) ? r.filtros : [])
    .map((f) => {
      const item = (f ?? {}) as Record<string, unknown>;
      return {
        coluna: exigirColuna(item.coluna, colunas),
        valor: typeof item.valor === 'string' ? item.valor.trim() : '',
      };
    })
    .filter((f) => f.valor !== '');

  return { pagina, porPagina, ordenar, filtros };
}

/**
 * Escapa os curingas do `LIKE` dentro do valor procurado.
 *
 * Sem isto, procurar por `100%` viraria "qualquer coisa começando com 100" — o
 * usuário digitou um caractere literal e receberia um padrão.
 */
function escaparLike(valor: string): string {
  return valor.replace(/([\\%_])/g, '\\$1');
}

export function montarConsultaDeTabela(
  alvo: AlvoDeTabela,
  pedido: PedidoDeTabela
): ConsultaDeTabela {
  const numerado = alvo.marcador === 'numerado';
  const params: string[] = [];

  const condicoes = pedido.filtros.map((f) => {
    params.push(`%${escaparLike(f.valor)}%`);
    const marca = numerado ? `$${params.length}` : '?';
    return `${quoteIdentifier(f.coluna, alvo.estilo)} LIKE ${marca}`;
  });

  const onde = condicoes.length === 0 ? '' : `\n WHERE ${condicoes.join(' AND ')}`;
  const ordem =
    pedido.ordenar === null
      ? ''
      : `\n ORDER BY ${quoteIdentifier(pedido.ordenar.coluna, alvo.estilo)} ` +
        `${pedido.ordenar.desc ? 'DESC' : 'ASC'}`;

  // `OFFSET 0` é ruído no SQL que o usuário lê no topo da aba.
  const pulo = (pedido.pagina - 1) * pedido.porPagina;
  const limite = `\n LIMIT ${pedido.porPagina}${pulo === 0 ? '' : ` OFFSET ${pulo}`}`;

  return {
    sql: `SELECT *\n  FROM ${alvo.alvo}${onde}${ordem}${limite}`,
    // Sem `ORDER BY`: ordenar para contar é trabalho jogado fora, e em tabela
    // grande é a diferença entre instantâneo e minutos.
    contagem: `SELECT COUNT(*) AS ${APELIDO_DA_CONTAGEM} FROM ${alvo.alvo}${onde}`,
    params,
  };
}
