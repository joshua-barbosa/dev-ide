// Editar um CSV pela grade (P5).
//
// Pedido dele em 02/09/2026: *"Sim, isso eu constantemente uso"*. É a resposta à
// pergunta que eu tinha deixado aberta desde a spec 068.
//
// **O problema é a identidade da linha.** A edição célula a célula da spec 044
// monta um `UPDATE ... WHERE chave = ?`, e por isso exige chave primária. Um CSV
// não tem chave: duas linhas idênticas são duas linhas idênticas, e nada no
// arquivo as distingue.
//
// A saída é a única honesta: **a identidade é a POSIÇÃO**. A linha 12 é a linha
// 12. Isso funciona, e traz duas obrigações que este arquivo cumpre:
//
// 1. quem edita precisa saber a posição ORIGINAL, e não a da tela — ordenar a
//    grade e depois editar gravaria no lugar errado;
// 2. o arquivo tem de ser escrito INTEIRO, do jeito que foi lido.

/**
 * Um campo, escapado como o CSV manda.
 *
 * Aspas só quando precisa — separador, aspa, ou quebra de linha dentro do
 * campo. Pôr aspas em tudo funcionaria e deixaria o arquivo irreconhecível para
 * quem o abriu antes: o `git diff` de uma célula editada mostraria o arquivo
 * inteiro mudado.
 */
export function campoEmTexto(valor: string, separador: string): string {
  const precisa =
    valor.includes(separador) ||
    valor.includes('"') ||
    valor.includes('\n') ||
    valor.includes('\r');
  return precisa ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/** O inverso de `lerTabular`. */
export function escreverTabular(
  linhas: readonly (readonly string[])[],
  separador: string,
  quebra: '\n' | '\r\n' = '\n'
): string {
  return linhas.map((l) => l.map((c) => campoEmTexto(c, separador)).join(separador)).join(quebra);
}

/**
 * A quebra de linha que o arquivo já usava.
 *
 * Reescrever um CSV do Windows com `\n` mudaria TODAS as linhas no diff por
 * causa de uma célula — e num repositório compartilhado isso é um conflito
 * garantido com quem estiver mexendo no mesmo arquivo.
 */
export function quebraDe(conteudo: string): '\n' | '\r\n' {
  return conteudo.includes('\r\n') ? '\r\n' : '\n';
}

/** Se o arquivo terminava com quebra de linha — e ele deve continuar terminando. */
export function terminaComQuebra(conteudo: string): boolean {
  return conteudo.endsWith('\n');
}

export interface TrocaDeCelula {
  /** A linha na ORDEM DO ARQUIVO, contando o cabeçalho. Base 0. */
  readonly linha: number;
  readonly coluna: number;
  readonly valor: string;
}

/**
 * Por que este arquivo NÃO pode ser gravado, ou `null`.
 *
 * O motivo que importa é o truncamento: `lerTabular` para em 5.000 linhas, e a
 * grade mostra só o que leu. Gravar de volta o que está na tela **apagaria todo
 * o resto do arquivo** — silenciosamente, e sem desfazer. É o pior defeito
 * possível num editor, então ele é impedido aqui e não na tela.
 */
export function porQueNaoPodeGravar(truncado: boolean): string | null {
  return truncado
    ? 'Este CSV é grande demais e foi aberto só em parte. Editar pela grade ' +
        'gravaria apenas o pedaço visível e apagaria o resto do arquivo — ' +
        'então a edição fica desligada. Abra como texto para mexer nele.'
    : null;
}

/**
 * Aplica as trocas às linhas lidas.
 *
 * Imutável, e **por posição**: `linha` é o índice no ARQUIVO, e não na tela.
 * Uma troca fora do alcance é ignorada em vez de criar linha ou coluna do nada
 * — a grade não deveria pedir isso, e se pedir, o arquivo não é o lugar de
 * descobrir.
 */
export function aplicarTrocasNoCsv(
  linhas: readonly (readonly string[])[],
  trocas: readonly TrocaDeCelula[]
): readonly (readonly string[])[] {
  if (trocas.length === 0) return linhas;
  const saida = linhas.map((l) => [...l]);
  for (const t of trocas) {
    const alvo = saida[t.linha];
    if (alvo === undefined || t.coluna < 0 || t.coluna >= alvo.length) continue;
    alvo[t.coluna] = t.valor;
  }
  return saida;
}

/**
 * O conteúdo novo do arquivo, pronto para gravar.
 *
 * Junta tudo: lê a quebra e o final do ORIGINAL, aplica as trocas e reescreve.
 * Sem trocas, devolve o original **intacto** — e não uma reescrita idêntica em
 * espírito: um arquivo com aspas onde não precisava, ou sem a quebra final,
 * apareceria no diff inteiro sem ninguém ter editado nada.
 */
export function csvComTrocas(
  original: string,
  linhas: readonly (readonly string[])[],
  separador: string,
  trocas: readonly TrocaDeCelula[]
): string {
  if (trocas.length === 0) return original;
  const novas = aplicarTrocasNoCsv(linhas, trocas);
  const texto = escreverTabular(novas, separador, quebraDe(original));
  return terminaComQuebra(original) ? `${texto}${quebraDe(original)}` : texto;
}
