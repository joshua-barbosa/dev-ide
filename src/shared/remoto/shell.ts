// Citar para o shell (spec 053).
//
// Mora em `shared` e é puro porque é uma regra de segurança, e regra de
// segurança precisa de teste. O caminho que chega aqui veio da árvore do
// servidor — não foi digitado —, mas nome de arquivo aceita espaço, aspas,
// cifrão e ponto-e-vírgula, e nenhum deles pode virar sintaxe.

/**
 * Envolve em aspas SIMPLES, que o shell não interpreta.
 *
 * Dentro de aspas simples só a própria aspa simples é especial, e a única saída
 * é fechar, escapar uma aspa e reabrir — é o `'\\''` do meio. Cifrão, crase,
 * espaço, `;`, `&&` e `$(...)` viram texto por construção.
 */
export function aspasDeShell(texto: string): string {
  return `'${texto.split("'").join(`'\\''`)}'`;
}
