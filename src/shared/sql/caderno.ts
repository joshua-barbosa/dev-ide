// O formato do Query Book (spec 048).
//
// `.sqlbook` é JSON, e não um texto com separadores. A alternativa parecia
// melhor — continuaria legível e comparável no git —, mas quebra no primeiro
// bloco que contiver a própria marca. E um caderno de SQL contém SQL
// arbitrário: qualquer sequência que se escolha como separador pode aparecer
// dentro de um bloco.
//
// Leitura **tolerante**, como todo arquivo do usuário nesta IDE: bloco estragado
// é descartado, arquivo ilegível vira caderno vazio. Falhar aqui trocaria um
// caderno com um erro por nenhum caderno.

/** A versão do formato. Sobe quando a forma mudar de um jeito incompatível. */
export const VERSAO_DO_CADERNO = 1;

export type TipoDeCelula = 'sql' | 'markdown';

export interface Celula {
  /** Estável por bloco: é o que o React usa como chave, e o que o foco segue. */
  readonly id: string;
  readonly tipo: TipoDeCelula;
  readonly conteudo: string;
}

export interface Caderno {
  readonly celulas: readonly Celula[];
}

export const CADERNO_VAZIO: Caderno = { celulas: [] };

/** Um bloco novo, vazio. O id não precisa ser único no mundo — só no caderno. */
export function novaCelula(tipo: TipoDeCelula, sufixo: number): Celula {
  return { id: `c${sufixo}`, tipo, conteudo: '' };
}

function ehTipo(bruto: unknown): bruto is TipoDeCelula {
  return bruto === 'sql' || bruto === 'markdown';
}

/**
 * Lê um `.sqlbook`.
 *
 * Nunca lança. Um arquivo que não é JSON, ou que é JSON de outra coisa, vira
 * caderno vazio; um bloco sem tipo ou sem conteúdo é descartado e os vizinhos
 * sobrevivem.
 */
export function lerCaderno(texto: string): Caderno {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return CADERNO_VAZIO;
  }
  if (bruto === null || typeof bruto !== 'object') return CADERNO_VAZIO;

  const lista = (bruto as { celulas?: unknown }).celulas;
  if (!Array.isArray(lista)) return CADERNO_VAZIO;

  const celulas: Celula[] = [];
  lista.forEach((item, i) => {
    const c = (item ?? {}) as Record<string, unknown>;
    if (!ehTipo(c.tipo) || typeof c.conteudo !== 'string') return;
    // O id do arquivo é ignorado de propósito: dois blocos com o mesmo id
    // fariam o React confundir um com o outro, e nada garante que o arquivo
    // que veio de fora respeite isso.
    celulas.push({ id: `c${i}`, tipo: c.tipo, conteudo: c.conteudo });
  });
  return { celulas };
}

/** Grava o caderno. O `id` NÃO vai para o arquivo: ele é de tela, não de dado. */
export function escreverCaderno(caderno: Caderno): string {
  const dados = {
    versao: VERSAO_DO_CADERNO,
    celulas: caderno.celulas.map((c) => ({ tipo: c.tipo, conteudo: c.conteudo })),
  };
  return `${JSON.stringify(dados, null, 2)}\n`;
}

/**
 * Insere um bloco numa **fresta** — a posição ENTRE dois blocos.
 *
 * Conta frestas, e não blocos: `0` é antes do primeiro, `n` é depois do último.
 * Até a spec 050 esta função contava "depois de qual bloco", e `-1` queria dizer
 * "no fim". As duas coordenadas conviveram mal por exatamente um teste: a fresta
 * 0 vira `depoisDe = -1`, que é o começo na conta das frestas e o FIM na outra.
 * Um sistema de coordenadas só, igual ao de `reordenar`, fecha essa porta.
 */
export function inserir(
  caderno: Caderno,
  tipo: TipoDeCelula,
  fresta: number,
  sufixo: number
): Caderno {
  const nova = novaCelula(tipo, sufixo);
  const onde = Math.max(0, Math.min(fresta, caderno.celulas.length));
  return {
    celulas: [...caderno.celulas.slice(0, onde), nova, ...caderno.celulas.slice(onde)],
  };
}

export function alterar(caderno: Caderno, id: string, conteudo: string): Caderno {
  return {
    celulas: caderno.celulas.map((c) => (c.id === id ? { ...c, conteudo } : c)),
  };
}

export function remover(caderno: Caderno, id: string): Caderno {
  return { celulas: caderno.celulas.filter((c) => c.id !== id) };
}

/**
 * Move um bloco uma posição.
 *
 * Nas pontas não faz nada — e não é engano: mover o primeiro para cima não tem
 * para onde ir, e embrulhar para o fim seria uma surpresa desagradável.
 */
export function mover(caderno: Caderno, id: string, direcao: -1 | 1): Caderno {
  const i = caderno.celulas.findIndex((c) => c.id === id);
  const j = i + direcao;
  if (i === -1 || j < 0 || j >= caderno.celulas.length) return caderno;

  const celulas = [...caderno.celulas];
  const a = celulas[i];
  const b = celulas[j];
  if (a === undefined || b === undefined) return caderno;
  celulas[i] = b;
  celulas[j] = a;
  return { celulas };
}

/**
 * Move um bloco para uma **fresta** — a posição ENTRE dois blocos (spec 050).
 *
 * `destino` conta frestas, não blocos: `0` é antes do primeiro, `n` é depois do
 * último. É assim porque é o que o arraste sabe dizer — o mouse cai entre duas
 * coisas, não sobre uma.
 *
 * A armadilha está no desconto: tirar o bloco da posição `i` faz tudo que vinha
 * depois descer uma casa, então uma fresta ADIANTE de `i` vale um a menos. Sem
 * isso, arrastar para a frente sempre erra por um.
 *
 * Soltar numa das duas frestas que encostam no próprio bloco devolve o caderno
 * IDÊNTICO — não só igual: é o que impede um arraste que não mudou nada de
 * marcar o arquivo como alterado.
 */
export function reordenar(caderno: Caderno, id: string, destino: number): Caderno {
  const i = caderno.celulas.findIndex((c) => c.id === id);
  if (i === -1) return caderno;

  const fresta = Math.max(0, Math.min(destino, caderno.celulas.length));
  if (fresta === i || fresta === i + 1) return caderno;

  const restantes = caderno.celulas.filter((_, k) => k !== i);
  const onde = fresta > i ? fresta - 1 : fresta;
  const celula = caderno.celulas[i];
  if (celula === undefined) return caderno;
  return { celulas: [...restantes.slice(0, onde), celula, ...restantes.slice(onde)] };
}

/** Os blocos que o `Run All` roda, na ordem — markdown fica de fora. */
export function blocosExecutaveis(caderno: Caderno): readonly Celula[] {
  return caderno.celulas.filter((c) => c.tipo === 'sql' && c.conteudo.trim() !== '');
}
