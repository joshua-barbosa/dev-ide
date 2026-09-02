// A trilha acima do editor: onde eu estou (T075).
//
// Duas partes, e a segunda é a que vale: **a pasta e o arquivo**, que se lê no
// título da aba, e **o símbolo** — a classe e a função em que o cursor está.
// Num arquivo de oitocentas linhas, saber que se está dentro de
// `TabelaHost › carregarPagina` é a diferença entre navegar e rolar.
//
// A lista de símbolos já existe (`server/symbols.ts`, spec 016). O que faltava
// era a pergunta ao contrário: em vez de "quais símbolos há", **"qual símbolo
// contém esta linha"**.

export interface DegrauDaTrilha {
  readonly rotulo: string;
  /** `pasta`, `arquivo` ou o tipo do símbolo (`class`, `function`…). */
  readonly tipo: string;
  /** Para onde ir ao clicar. Ausente nos degraus de pasta. */
  readonly linha?: number;
}

/**
 * O que a trilha precisa saber de um símbolo.
 *
 * Os NOMES são os do `SymbolInfo` que a IDE já usa (`name`, `kind`, `line`, e
 * `file`) — a lista do painel de símbolos entra aqui direto, sem tradutor no
 * meio. Um formato próprio criaria uma segunda verdade sobre o que é um
 * símbolo.
 */
export interface SimboloDaTrilha {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  /** De qual arquivo ele é — a trilha usa só os do arquivo em foco. */
  readonly file?: string;
  /** A última linha dele. Ausente = a IDE deduz pelo próximo símbolo. */
  readonly lineEnd?: number;
}

/**
 * Os degraus de pasta e arquivo, relativos à raiz aberta.
 *
 * **A raiz não entra.** Ela é a mesma em toda trilha, e repetir
 * `/home/joshua/Documentos/projetos/…` em cada arquivo ocuparia a barra inteira
 * sem informar nada.
 */
export function trilhaDoCaminho(caminho: string, raiz: string): readonly DegrauDaTrilha[] {
  const base = raiz.replace(/\/+$/, '');
  const dentro = caminho.startsWith(`${base}/`) ? caminho.slice(base.length + 1) : caminho;
  const partes = dentro.split('/').filter((p) => p !== '');

  return partes.map((parte, i) => ({
    rotulo: parte,
    tipo: i === partes.length - 1 ? 'arquivo' : 'pasta',
  }));
}

/**
 * Os símbolos que CONTÊM esta linha, do mais externo para o mais interno.
 *
 * O aninhamento é deduzido do alcance: um símbolo contém o outro quando começa
 * antes e termina depois. Isso funciona sem a lista ser uma árvore — e ela não
 * é, porque `server/symbols.ts` a devolve plana desde a spec 016.
 *
 * **Sem `linhaFim`, o fim é o começo do próximo símbolo do mesmo nível ou de
 * nível acima.** É uma aproximação, e ela erra num caso: código depois do
 * último `}` de uma classe, antes do próximo símbolo, aparece como se ainda
 * estivesse dentro dela. O erro é pequeno e a alternativa — analisar o arquivo
 * de novo só para a trilha — custaria uma varredura por movimento de cursor.
 */
export function trilhaDoSimbolo(
  simbolos: readonly SimboloDaTrilha[],
  linha: number
): readonly DegrauDaTrilha[] {
  const ordenados = [...simbolos].sort((a, b) => a.line - b.line);
  const comFim = ordenados.map((s, i) => ({
    ...s,
    fim: s.lineEnd ?? (ordenados[i + 1]?.line ?? Number.MAX_SAFE_INTEGER) - 1,
  }));

  const contendo = comFim.filter((s) => s.line <= linha && linha <= s.fim);
  // Do mais EXTERNO para o mais interno: o de alcance maior primeiro. Um
  // símbolo que contém o outro sempre começa antes ou na mesma linha.
  return contendo
    .sort((a, b) => b.fim - b.line - (a.fim - a.line))
    .map((s) => ({ rotulo: s.name, tipo: s.kind, linha: s.line }));
}

/**
 * A trilha inteira: caminho e símbolo.
 *
 * Junta as duas metades num lugar só para a tela não ter de saber que são duas
 * — e para o teste conferir a ordem, que é a parte que se erra: o símbolo vem
 * DEPOIS do arquivo, e não antes.
 */
export function trilha(
  caminho: string,
  raiz: string,
  simbolos: readonly SimboloDaTrilha[],
  linha: number
): readonly DegrauDaTrilha[] {
  // **Só os símbolos DESTE arquivo.** A lista do painel é do projeto inteiro, e
  // sem o filtro a trilha mostraria a classe de outro arquivo qualquer que
  // tivesse uma linha com o mesmo número.
  const daqui = simbolos.filter((s) => s.file === undefined || s.file === caminho);
  return [...trilhaDoCaminho(caminho, raiz), ...trilhaDoSimbolo(daqui, linha)];
}
