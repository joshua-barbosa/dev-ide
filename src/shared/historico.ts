// Histórico de navegação: por onde o usuário passou.
//
// **Só salto entra aqui, nunca movimento de cursor.** É a decisão que separa
// "voltar para onde eu estava" de "desfazer o cursor": registrar cada tecla
// faria `Back` andar uma casa por vez e não servir para nada.
//
// A forma é a de qualquer navegador: uma lista e um índice. Navegar para um
// lugar novo depois de ter voltado **descarta o que estava à frente** — é o que
// todo mundo espera, e é a regra que erra quando se implementa de cabeça.

export interface Posicao {
  readonly abaId: string;
  readonly linha: number;
}

export interface Historico {
  readonly posicoes: readonly Posicao[];
  /** Onde estamos na lista. `-1` = lista vazia. */
  readonly indice: number;
}

export const HISTORICO_VAZIO: Historico = { posicoes: [], indice: -1 };
export const MAX_POSICOES = 50;

function mesmaPosicao(a: Posicao | undefined, b: Posicao): boolean {
  return a !== undefined && a.abaId === b.abaId && a.linha === b.linha;
}

/**
 * Registra um salto.
 *
 * Corta o que está à frente do índice atual: depois de voltar duas vezes e
 * pular para outro lugar, o caminho antigo deixa de existir.
 */
export function registrar(historico: Historico, posicao: Posicao): Historico {
  if (mesmaPosicao(historico.posicoes[historico.indice], posicao)) return historico;

  const ateAqui = historico.posicoes.slice(0, historico.indice + 1);
  const comNova = [...ateAqui, posicao];
  // Corta pela FRENTE ao estourar o teto: o que se perde é o passado distante,
  // não o presente.
  const posicoes = comNova.slice(Math.max(0, comNova.length - MAX_POSICOES));
  return { posicoes, indice: posicoes.length - 1 };
}

export function podeVoltar(historico: Historico): boolean {
  return historico.indice > 0;
}

export function podeAvancar(historico: Historico): boolean {
  return historico.indice >= 0 && historico.indice < historico.posicoes.length - 1;
}

export interface Movimento {
  readonly historico: Historico;
  /** Para onde ir; `null` quando não havia destino válido. */
  readonly destino: Posicao | null;
}

/**
 * Anda no histórico, pulando posições de abas que não existem mais.
 *
 * `abaExiste` é injetado para este módulo continuar puro — ele não sabe o que é
 * uma aba, só recebe um teste.
 */
function andar(
  historico: Historico,
  passo: -1 | 1,
  abaExiste: (abaId: string) => boolean
): Movimento {
  let indice = historico.indice;
  for (;;) {
    const proximo = indice + passo;
    if (proximo < 0 || proximo >= historico.posicoes.length) {
      // Não achou destino válido: fica onde estava, em vez de mover o índice
      // para um lugar de onde não dá para voltar.
      return { historico, destino: null };
    }
    indice = proximo;
    const posicao = historico.posicoes[indice];
    if (posicao !== undefined && abaExiste(posicao.abaId)) {
      return { historico: { ...historico, indice }, destino: posicao };
    }
  }
}

export function voltar(historico: Historico, abaExiste: (abaId: string) => boolean): Movimento {
  return andar(historico, -1, abaExiste);
}

export function avancar(historico: Historico, abaExiste: (abaId: string) => boolean): Movimento {
  return andar(historico, 1, abaExiste);
}

/** Tira as posições de uma aba fechada, para o histórico não encher de lixo. */
export function esquecerAba(historico: Historico, abaId: string): Historico {
  const posicoes = historico.posicoes.filter((p) => p.abaId !== abaId);
  if (posicoes.length === historico.posicoes.length) return historico;
  // O índice acompanha: quantas posições ANTES dele foram removidas.
  const removidasAntes = historico.posicoes
    .slice(0, historico.indice + 1)
    .filter((p) => p.abaId === abaId).length;
  const indice = Math.min(historico.indice - removidasAntes, posicoes.length - 1);
  return { posicoes, indice: Math.max(indice, posicoes.length === 0 ? -1 : 0) };
}
