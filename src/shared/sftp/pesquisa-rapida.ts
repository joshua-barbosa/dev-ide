// A pesquisa rápida da lista de arquivos remotos (SFTP e FTP), como a do
// FileZilla. O relato (01/10): "aqui não tem um pesquisar na pasta igual no
// FileZilla" — numa pasta de 138 arquivos, ele procurava "26314".
//
// Sem diferença de maiúscula e de acento. Sem coringa, é um trecho em
// qualquer parte do nome; com `*` ou `?`, o nome INTEIRO tem de casar
// (`*.inf` = termina em .inf). O resto é texto, nunca expressão regular.
//
// Pura: filtra o que JÁ foi listado — não vai ao servidor.

const sem = (texto: string): string => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filtrarPorNome<T extends { readonly name: string }>(entradas: readonly T[], termo: string): T[] {
  const t = sem(termo.trim());
  if (t === '') return [...entradas];
  if (/[*?]/.test(t)) {
    const corpo = t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    const re = new RegExp(`^${corpo}$`);
    return entradas.filter((e) => re.test(sem(e.name)));
  }
  return entradas.filter((e) => sem(e.name).includes(t));
}
