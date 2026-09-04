// Busca dentro do resultado que JÁ está na tela.
//
// Não confundir com o filtro por coluna (T057): aquele reescreve o `WHERE` e
// volta ao banco, e por isso só existe onde a IDE montou o SQL. Esta olha
// apenas o que foi trazido — funciona em qualquer grade, inclusive na aba
// `Result` de um SQL escrito à mão, e não custa viagem nenhuma.
//
// É o gesto de quem já rodou a consulta e quer achar uma linha no meio das 500.

/** Termo que não filtra nada. */
export const TERMO_VAZIO = '';

/**
 * As linhas que contêm o termo em ALGUMA coluna, sem ligar para maiúsculas.
 *
 * Devolve o MESMO array quando não há o que filtrar: a grade compara por
 * identidade para decidir se repinta, e uma cópia nova a cada tecla a faria
 * redesenhar 500 linhas à toa.
 *
 * `null` não vira a palavra `"null"`. Se virasse, procurar por `nul` traria
 * toda linha com célula vazia — e quem quer isso usa o filtro por coluna, que
 * fala com o banco e sabe a diferença entre `NULL` e a string `'null'`.
 */
export function linhasQueCasam<L extends readonly unknown[]>(
  linhas: readonly L[],
  termo: string
): readonly L[] {
  const alvo = termo.trim().toLowerCase();
  if (alvo === TERMO_VAZIO) return linhas;

  return linhas.filter((linha) =>
    linha.some((celula) =>
      celula === null || celula === undefined
        ? false
        : String(celula).toLowerCase().includes(alvo)
    )
  );
}
