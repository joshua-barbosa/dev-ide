// Interpretar "linha:coluna" digitado pelo usuário.
//
// É o que o VS Code aceita na caixa de "ir para": `12` leva à linha 12, e
// `12:5` leva à linha 12, coluna 5. Parece trivial e não é — o que erra aqui é
// o que fazer com o que está fora do documento, e a resposta certa não é
// recusar.
//
// **Número maior que o arquivo vai para o fim, não vira erro.** Quem digita
// `9999` está dizendo "o final"; devolver uma mensagem de recusa seria
// tecnicamente correto e praticamente inútil. Mesma coisa para a coluna.

export interface Posicao {
  readonly linha: number;
  readonly coluna: number;
}

/**
 * Lê o que foi digitado, ou `null` se não dá para entender.
 *
 * `totalDeLinhas` serve para limitar: sem ele, saltar para uma linha que não
 * existe deixa o editor num estado que o usuário não pediu.
 *
 * Aceita `:` e `,` como separador. O primeiro é o do VS Code; o segundo é o que
 * a barra de status mostra ("Ln 12, Col 5"), e é o que a mão copia de lá.
 */
export function interpretarPosicao(bruto: string, totalDeLinhas: number): Posicao | null {
  const limpo = bruto.trim();
  if (limpo === '') return null;

  const partes = limpo.split(/[:,]/).map((p) => p.trim());
  if (partes.length > 2) return null;

  const linha = lerNumero(partes[0]);
  if (linha === null) return null;

  // Sem coluna, começa a linha — que é o que se quer em 90% dos casos.
  const coluna = partes.length === 1 ? 1 : lerNumero(partes[1]);
  if (coluna === null) return null;

  const maximo = Math.max(1, Math.trunc(totalDeLinhas));
  return { linha: Math.min(linha, maximo), coluna };
}

/** Inteiro positivo, e nada mais. `1.5`, `-3` e `abc` não passam. */
function lerNumero(bruto: string | undefined): number | null {
  if (bruto === undefined || !/^\d+$/.test(bruto)) return null;
  const n = Number(bruto);
  // Zero não existe: linha e coluna começam em 1, como a barra de status mostra.
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** O texto de ajuda da caixa, com o alcance do arquivo aberto. */
export function dicaDePosicao(totalDeLinhas: number): string {
  return `Linha entre 1 e ${Math.max(1, totalDeLinhas)} — ou linha:coluna`;
}
