// O painel inferior, como dado.
//
// Duas coisas moram aqui: quais abas existem e como os problemas se acumulam.
// A segunda é a que erra na prática — teto, ordem e contagem são fáceis de
// escrever errado e difíceis de notar olhando a tela.
//
// **`Debug Console` não está na lista de propósito.** Ele pressupõe depurador,
// e a decisão registrada em `product.md` é que não haverá um; declará-lo seria
// promessa parada.

export type AbaDoPainel = 'output' | 'problems' | 'terminal';

export const ABAS_DO_PAINEL: ReadonlyArray<readonly [AbaDoPainel, string]> = [
  ['output', 'Output'],
  ['problems', 'Problems'],
  ['terminal', 'Terminal'],
];

export function ehAbaDoPainel(valor: string): valor is AbaDoPainel {
  return ABAS_DO_PAINEL.some(([id]) => id === valor);
}

/** De onde o problema veio. É o que o usuário lê primeiro na linha. */
export type OrigemDoProblema = 'execução' | 'conexão' | 'terminal' | 'ide';

export interface Problema {
  readonly id: string;
  readonly origem: OrigemDoProblema;
  readonly mensagem: string;
  /** ISO; a interface formata. Guardar formatado impediria reformatar depois. */
  readonly quando: string;
}

export const MAX_PROBLEMAS = 200;

/**
 * Acrescenta um problema, mais novo primeiro, com teto.
 *
 * Imutável (Artigo IV). O teto existe porque um laço de erro — uma conexão que
 * cai e é retentada — encheria a lista até engasgar a página.
 */
export function registrarProblema(
  atuais: readonly Problema[],
  problema: Problema
): readonly Problema[] {
  return [problema, ...atuais].slice(0, MAX_PROBLEMAS);
}

/**
 * Remove problemas repetidos em sequência.
 *
 * Não é enfeite: a mesma falha de conexão costuma chegar por dois caminhos (a
 * chamada que falhou e o diálogo que a mostrou), e a lista ficaria com pares
 * idênticos que não ensinam nada.
 */
export function ehRepeticao(
  atuais: readonly Problema[],
  origem: OrigemDoProblema,
  mensagem: string
): boolean {
  const ultimo = atuais[0];
  return ultimo !== undefined && ultimo.origem === origem && ultimo.mensagem === mensagem;
}
