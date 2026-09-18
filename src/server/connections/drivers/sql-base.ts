// Helpers compartilhados pelos drivers SQL.
//
// Só funções puras: o que depende de rede fica em cada driver. Isso mantém a
// parte mais fácil de errar (quoting e normalização de valor) testável sem
// nenhum banco de pé.
import type { CellValue } from '../types';
import { ORCAMENTO_PADRAO } from '../../../shared/grade/cortes';

export { ORCAMENTO_PADRAO };

export type QuoteStyle = 'backtick' | 'double' | 'bracket';

export const DEFAULT_ROW_LIMIT = 500;
export const MAX_ROW_LIMIT = 50_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
/**
 * Teto por célula QUANDO O ORÇAMENTO DA PÁGINA ACABA — uma amostra, não o valor.
 *
 * Era o teto de TODA célula, e o preço estava no lugar errado: ele abria um JSON
 * de 14 mil caracteres na lupa e via 2048 e um "…", com o JSON quebrado. O
 * corte não pagava o que prometia, porque o custo da grade não é o texto que
 * atravessa a rede — é o texto que vai para o DOM, e a célula mostra uma linha.
 * Por isso o corte mudou de lugar: o desenho recorta (ver `RECORTE_NO_DESENHO`),
 * e o transporte gasta um orçamento de página.
 */
export const MAX_CELL_CHARS = 2048;



/**
 * O orçamento de UMA página de resultado.
 *
 * Tem estado — o que resta — e é por isso que é objeto e não função: o corte só
 * pode ser decidido sabendo o que as células anteriores já gastaram. Vive o
 * tempo de uma consulta e morre com ela.
 */
export class OrcamentoDeCelulas {
  private restante: number;
  private readonly cortadas = new Map<string, number>();

  constructor(total: number = ORCAMENTO_PADRAO) {
    this.restante = Number.isFinite(total) && total > 0 ? Math.trunc(total) : ORCAMENTO_PADRAO;
  }

  /** Uma linha inteira, na ordem das colunas. Devolve o que a grade recebe. */
  linha(indice: number, valores: readonly unknown[]): CellValue[] {
    return valores.map((valor, coluna) => this.celula(indice, coluna, valor));
  }

  /** Onde a página estourou: `"linha:coluna"` → tamanho REAL do valor. */
  get cortes(): Record<string, number> {
    return Object.fromEntries(this.cortadas);
  }

  private celula(linha: number, coluna: number, valor: unknown): CellValue {
    const cru = paraCelulaCrua(valor);
    if (typeof cru !== 'string') return cru;
    if (cru.length <= this.restante) {
      this.restante -= cru.length;
      return cru;
    }
    // Não coube: vai uma amostra, e o tamanho de verdade fica registrado para o
    // visor poder dizer "mostrando 2.048 de 312.904" em vez de mentir.
    this.cortadas.set(`${linha}:${coluna}`, cru.length);
    return `${cru.slice(0, MAX_CELL_CHARS)}…`;
  }
}

/**
 * O par de delimitadores de cada dialeto.
 *
 * `bracket` entrou com o SQL Server, e ele é o único em que **abre e fecha são
 * caracteres DIFERENTES** — por isso o par, e não um caractere só. A regra de
 * escape também muda: dentro de colchetes, só o `]` precisa ser dobrado.
 */
const QUOTES: Record<QuoteStyle, readonly [string, string]> = {
  backtick: ['`', '`'],
  double: ['"', '"'],
  bracket: ['[', ']'],
};

/**
 * Cita um identificador (schema, tabela, coluna) dobrando a aspa interna.
 *
 * Nomes de objeto vêm do catálogo do banco, mas também de entrada do usuário
 * na UI — e não dá para parametrizar identificador em SQL, então esta é a
 * única barreira contra injeção por nome.
 */
export function quoteIdentifier(name: string, style: QuoteStyle): string {
  if (name.length === 0 || name.includes('\0')) {
    throw new Error(`Identificador inválido: ${JSON.stringify(name)}.`);
  }
  const [abre, fecha] = QUOTES[style];
  // Dobra o caractere de FECHAMENTO, que é o que termina o identificador. Nos
  // dialetos em que abre e fecha são iguais, isto é a regra de sempre.
  return abre + name.split(fecha).join(fecha + fecha) + fecha;
}

/**
 * Converte um valor do driver para algo que o grid e o JSON aguentam — SEM
 * cortar. Quem decide o corte é `OrcamentoDeCelulas`, que sabe o que a página
 * já gastou; aqui só se resolve o TIPO, porque quem lê a tela não pode receber
 * um `Buffer` nem um `bigint`.
 */
export function paraCelulaCrua(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export function resolveRowLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_ROW_LIMIT;
  return clamp(requested, 1, MAX_ROW_LIMIT);
}

export function resolveTimeout(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_TIMEOUT_MS;
  return clamp(requested, 1_000, MAX_TIMEOUT_MS);
}

/**
 * Lê um campo de lista de nomes (bancos/schemas visíveis) aceitando vírgula,
 * ponto e vírgula ou quebra de linha — o usuário digita do jeito que preferir.
 */
export function parseNameList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[,;\n\r]/)
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
}

/** Lista vazia = sem filtro (mostra tudo). Comparação sem diferenciar caixa. */
export function isVisible(name: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const alvo = name.toLowerCase();
  return allowed.some((permitido) => permitido.toLowerCase() === alvo);
}

export interface VisibilityOptions {
  /** Lista branca; vazia = sem filtro. */
  readonly show: readonly string[];
  /** Regex de exclusão; vazio = não exclui. Regex inválida é ignorada. */
  readonly excludePattern: string;
  readonly hideSystem: boolean;
  readonly systemNames: readonly string[];
}

/**
 * Aplica, nesta ordem: esconder schemas de sistema, excluir por regex e manter
 * só a lista branca. Uma regex malformada digitada pelo usuário não pode
 * derrubar a navegação, então ela é simplesmente ignorada.
 */
export function applyVisibility<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  options: VisibilityOptions
): T[] {
  let excluir: RegExp | null = null;
  if (options.excludePattern.trim().length > 0) {
    try {
      excluir = new RegExp(options.excludePattern, 'i');
    } catch {
      excluir = null;
    }
  }

  return items.filter((item) => {
    const nome = nameOf(item);
    if (options.hideSystem && isVisible(nome, options.systemNames) && options.systemNames.length > 0) {
      return false;
    }
    if (excluir !== null && excluir.test(nome)) return false;
    return isVisible(nome, options.show);
  });
}

/** Move o item principal para o topo, preservando a ordem dos demais. */
export function mainFirst<T>(items: readonly T[], main: string, nameOf: (item: T) => string): T[] {
  if (main.trim().length === 0) return [...items];
  const alvo = main.trim().toLowerCase();
  const principal = items.filter((item) => nameOf(item).toLowerCase() === alvo);
  if (principal.length === 0) return [...items];
  return [...principal, ...items.filter((item) => nameOf(item).toLowerCase() !== alvo)];
}
