// Helpers compartilhados pelos drivers SQL.
//
// Só funções puras: o que depende de rede fica em cada driver. Isso mantém a
// parte mais fácil de errar (quoting e normalização de valor) testável sem
// nenhum banco de pé.
import type { CellValue } from '../types';

export type QuoteStyle = 'backtick' | 'double';

export const DEFAULT_ROW_LIMIT = 500;
export const MAX_ROW_LIMIT = 50_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
/** Teto de caracteres por célula: BLOB e JSON grandes travariam o grid. */
export const MAX_CELL_CHARS = 2048;

const QUOTES: Record<QuoteStyle, string> = { backtick: '`', double: '"' };

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
  const quote = QUOTES[style];
  return quote + name.split(quote).join(quote + quote) + quote;
}

function truncate(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

/** Converte um valor do driver para algo que o grid e o JSON aguentam. */
export function formatCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    // Cada byte vira dois dígitos hex, e o prefixo "0x" também ocupa o teto.
    const maxBytes = Math.floor((MAX_CELL_CHARS - 2) / 2);
    const bytes = value.subarray(0, maxBytes);
    const hex = `0x${Buffer.from(bytes).toString('hex')}`;
    return value.byteLength > bytes.byteLength ? `${hex}…` : hex;
  }
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return truncate(String(value));
  }
}

/**
 * O mesmo que `formatCell`, mas SEM cortar (spec 062, fase D).
 *
 * Existe porque `formatCell` corta em `MAX_CELL_CHARS`, e é exatamente esse
 * corte que o visor da lupa precisa contornar — ele promete "o valor inteiro".
 * Toda a normalização de tipo continua igual: quem lê a tela não pode receber
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
