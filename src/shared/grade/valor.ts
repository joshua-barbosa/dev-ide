// O que dá para fazer com o valor de uma célula (spec 062, fase D).
//
// Puro porque "isto é JSON?" é a pergunta que decide se um botão existe, e
// errar nela produz interface que promete o que não cumpre.

/** O que o visor sabe mostrar. `json` só aparece quando o valor É JSON. */
export type ModoDoVisor = 'texto' | 'json';

/**
 * É JSON de verdade?
 *
 * Escalar solto NÃO conta. `JSON.parse('42')` devolve 42, e `JSON.parse('null')`
 * devolve null — pelo padrão os dois são JSON válidos, mas oferecer o modo
 * `JSON` para a coluna `id` de uma tabela seria ruído em toda linha. O modo só
 * ganha sentido quando há estrutura para indentar.
 */
export function pareceJson(bruto: string): boolean {
  const texto = bruto.trim();
  if (texto === '') return false;
  const primeiro = texto[0];
  if (primeiro !== '{' && primeiro !== '[') return false;
  try {
    const valor: unknown = JSON.parse(texto);
    return typeof valor === 'object' && valor !== null;
  } catch {
    return false;
  }
}

/**
 * Indenta, e devolve `null` quando não dá.
 *
 * `null` em vez de devolver o original: quem chama precisa saber que falhou,
 * para dizer ao usuário em vez de mostrar o texto igual e parecer que o botão
 * não funciona.
 */
export function indentar(bruto: string, espacos = 2): string | null {
  if (!pareceJson(bruto)) return null;
  try {
    return JSON.stringify(JSON.parse(bruto), null, espacos);
  } catch {
    return null;
  }
}

/** Tira a indentação: é o que volta para o banco quando ele grava. */
export function compactar(bruto: string): string | null {
  if (!pareceJson(bruto)) return null;
  try {
    return JSON.stringify(JSON.parse(bruto));
  } catch {
    return null;
  }
}

/** Os modos que fazem sentido para este valor, na ordem em que aparecem. */
export function modosDe(bruto: string): readonly ModoDoVisor[] {
  return pareceJson(bruto) ? (['texto', 'json'] as const) : (['texto'] as const);
}

/**
 * Como o valor entra no visor: `null` do banco vira campo VAZIO.
 *
 * Escrever a palavra `NULL` na caixa gravaria o TEXTO "NULL", que é outra
 * coisa. A grade já usa essa distinção desde a spec 044.
 */
export function paraEditar(valor: unknown): string {
  return valor === null || valor === undefined ? '' : String(valor);
}

/**
 * E como ele sai: vazio continua vazio, não vira `null` sozinho.
 *
 * Transformar campo vazio em `NULL` seria adivinhar — coluna de texto aceita
 * string vazia, e as duas coisas são diferentes no banco. Quem quer `NULL` usa
 * o gesto próprio, que a grade já tem (`Ctrl+0`).
 */
export function paraGravar(texto: string): string {
  return texto;
}

/** O tamanho, para o visor dizer com o que o usuário está lidando. */
export function resumoDe(bruto: string): string {
  const linhas = bruto === '' ? 0 : bruto.split('\n').length;
  const c = bruto.length;
  const caracteres = `${c.toLocaleString('pt-BR')} caractere${c === 1 ? '' : 's'}`;
  return linhas > 1 ? `${caracteres} · ${linhas} linhas` : caracteres;
}
