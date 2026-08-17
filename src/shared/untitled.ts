// Nomes de arquivo sem título.
//
// A numeração usa o MAIOR em uso, não a contagem: com `untitled-1` e
// `untitled-3` abertos, o próximo é 4. Contar daria 3, que já existe — e duas
// abas com o mesmo nome é confusão garantida na hora de salvar.

const PADRAO = /^untitled-(\d+)$/;

export const PREFIXO_SEM_TITULO = 'untitled';

/** Verdadeiro para os títulos que esta convenção gera. */
export function ehSemTitulo(titulo: string): boolean {
  return PADRAO.test(titulo);
}

export function proximoSemTitulo(titulosEmUso: readonly string[]): string {
  const usados = titulosEmUso
    .map((t) => PADRAO.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));

  const maior = usados.length === 0 ? 0 : Math.max(...usados);
  return `${PREFIXO_SEM_TITULO}-${maior + 1}`;
}
