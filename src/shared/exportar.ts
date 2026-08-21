// Exportar o que está na grade: CSV e JSON (spec 041).
//
// Lógica pura, porque escapar CSV é exatamente o tipo de coisa que "funciona"
// até o primeiro valor com vírgula dentro — e aí o arquivo abre torto no Excel
// sem nenhum erro no caminho.
import type { CellValue, ColumnInfo } from './contracts';

/**
 * Escapa um campo de CSV.
 *
 * A regra do RFC 4180: se o valor tem aspa, separador ou quebra de linha, ele
 * vai entre aspas, e a aspa interna é dobrada. `null` vira campo VAZIO, e não a
 * palavra "null" — senão não haveria como distinguir do texto "null".
 */
export function campoCsv(valor: CellValue, separador: string): string {
  if (valor === null) return '';
  const texto = String(valor);
  if (!texto.includes('"') && !texto.includes(separador) && !/[\r\n]/.test(texto)) return texto;
  return `"${texto.split('"').join('""')}"`;
}

export interface OpcoesDeCsv {
  /** `,` é o padrão do formato; `;` é o que o Excel em português espera. */
  readonly separador?: string;
}

export function paraCsv(
  columns: readonly ColumnInfo[],
  rows: readonly (readonly CellValue[])[],
  opcoes: OpcoesDeCsv = {}
): string {
  const sep = opcoes.separador ?? ',';
  const linhas = [
    columns.map((c) => campoCsv(c.name, sep)).join(sep),
    ...rows.map((linha) => linha.map((v) => campoCsv(v, sep)).join(sep)),
  ];
  // `\r\n` é o que o RFC pede, e o que evita uma linha só ao abrir no Windows.
  return `${linhas.join('\r\n')}\r\n`;
}

/** Linhas como objetos: é o que se espera ao pedir JSON, e não vetores soltos. */
export function paraJson(
  columns: readonly ColumnInfo[],
  rows: readonly (readonly CellValue[])[]
): string {
  const objetos = rows.map((linha) => {
    const objeto: Record<string, CellValue> = {};
    columns.forEach((coluna, i) => {
      objeto[coluna.name] = linha[i] ?? null;
    });
    return objeto;
  });
  return `${JSON.stringify(objetos, null, 2)}\n`;
}
