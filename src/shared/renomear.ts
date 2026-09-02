// Aplicar uma renomeação de símbolo ao texto (T038).
//
// **De trás para a frente dentro de cada arquivo.** Trocar do começo para o fim
// moveria os alvos seguintes a cada substituição: renomear `abc` por `abcdef` na
// coluna 5 empurra tudo o que vinha depois, e a próxima troca cairia no lugar
// errado. É o defeito clássico deste tipo de operação, e ele só aparece quando o
// nome novo tem tamanho diferente do velho — ou seja, quase sempre.
//
// Mora em `shared` porque é a parte que erra, e aqui ela é testada sem disco e
// sem navegador.

export interface LugarDeTroca {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
}

/** Agrupa por arquivo, para a confirmação dizer QUANTOS arquivos mudam. */
export function porArquivo<T extends LugarDeTroca>(
  lugares: readonly T[]
): ReadonlyMap<string, readonly T[]> {
  const mapa = new Map<string, T[]>();
  for (const l of lugares) {
    mapa.set(l.caminho, [...(mapa.get(l.caminho) ?? []), l]);
  }
  return mapa;
}

/**
 * Troca `nomeVelho` por `nomeNovo` nos lugares dados.
 *
 * **Confere o que está lá antes de trocar.** Se o arquivo mudou entre a
 * pergunta ao serviço e a gravação — outro editor, um `git checkout` —, trocar
 * às cegas corromperia o texto num lugar qualquer. A ocorrência que não bate é
 * pulada, e o resto continua.
 */
export function aplicarTrocas(
  conteudo: string,
  lugares: readonly LugarDeTroca[],
  nomeVelho: string,
  nomeNovo: string
): string {
  const linhas = conteudo.split('\n');
  const ordenados = [...lugares].sort((a, b) => b.linha - a.linha || b.coluna - a.coluna);

  for (const l of ordenados) {
    const linha = linhas[l.linha - 1];
    if (linha === undefined) continue;
    const inicio = l.coluna - 1;
    if (linha.slice(inicio, inicio + nomeVelho.length) !== nomeVelho) continue;
    linhas[l.linha - 1] =
      linha.slice(0, inicio) + nomeNovo + linha.slice(inicio + nomeVelho.length);
  }
  return linhas.join('\n');
}
