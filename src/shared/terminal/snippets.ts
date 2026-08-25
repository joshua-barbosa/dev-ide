// Comandos guardados por conexão de terminal (spec 058).
//
// Ele já tinha notado a sobreposição com o que discutimos no banco: *"acho que
// dá de cara com aquilo que conversamos no banco de dados, mas aqui faz
// sentido"*. E faz — no banco a pasta `Query` (spec 038) cobria a necessidade, e
// por isso o comando salvo saiu na spec 039. Num terminal não há pasta `Query`
// nenhuma, e o argumento não vale.
//
// Puro e testado porque é o que decide o que entra no armazém: um comando com
// nome vazio ou com mil linhas estraga a lista para sempre.

export const MAX_NOME = 60;
export const MAX_COMANDO = 4_000;
/** Teto por conexão. Snippet é atalho; duzentos atalhos não são atalho. */
export const MAX_SNIPPETS = 200;

/**
 * O caractere que não pode existir num comando.
 *
 * Escrito com escape, e não literal: um NUL no código-fonte é invisível na tela
 * e o projeto tem guarda contra ele.
 */
const NUL = '\u0000';

export interface SnippetDeTerminal {
  readonly id: string;
  readonly nome: string;
  readonly comando: string;
}

/**
 * Aceita ou recusa — e RECUSA, porque quem digitou foi o usuário.
 *
 * É a mesma distinção da spec 038: o que o usuário escreve é conferido e
 * devolvido com o motivo; o que a máquina escolhe é saneado em silêncio.
 */
export function validarSnippet(bruto: unknown): SnippetDeTerminal {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const nome = typeof o.nome === 'string' ? o.nome.trim() : '';
  const comando = typeof o.comando === 'string' ? o.comando.trim() : '';

  if (nome === '') throw new Error('O snippet precisa de um nome.');
  if (nome.length > MAX_NOME) throw new Error(`O nome passa de ${MAX_NOME} caracteres.`);
  if (comando === '') throw new Error('O snippet precisa de um comando.');
  if (comando.length > MAX_COMANDO) {
    throw new Error(`O comando passa de ${MAX_COMANDO} caracteres.`);
  }
  // NUL corta a string no meio do caminho quando ela chega numa chamada de
  // sistema — o que sobra roda, e não é o que estava escrito.
  if (comando.includes(NUL) || nome.includes(NUL)) {
    throw new Error('O snippet tem um caractere que não pode existir num comando.');
  }

  const id = typeof o.id === 'string' && o.id !== '' ? o.id : `s${Date.now()}`;
  return { id, nome, comando };
}

/** Grava ou substitui, preservando a ordem. Devolve a lista nova. */
export function guardar(
  atuais: readonly SnippetDeTerminal[],
  novo: SnippetDeTerminal
): readonly SnippetDeTerminal[] {
  const i = atuais.findIndex((s) => s.id === novo.id);
  if (i === -1) {
    if (atuais.length >= MAX_SNIPPETS) {
      throw new Error(`Limite de ${MAX_SNIPPETS} snippets por conexão.`);
    }
    return [...atuais, novo];
  }
  // No LUGAR, e não removendo e acrescentando: editar não pode mandar o
  // snippet para o fim da lista.
  return atuais.map((s) => (s.id === novo.id ? novo : s));
}

export function remover(
  atuais: readonly SnippetDeTerminal[],
  id: string
): readonly SnippetDeTerminal[] {
  return atuais.filter((s) => s.id !== id);
}

/**
 * Lê o que está no arquivo, descartando o que não serve.
 *
 * Tolerante como todo arquivo do usuário nesta IDE: um snippet estragado é
 * descartado e os vizinhos sobrevivem.
 */
export function lerLista(bruto: unknown): readonly SnippetDeTerminal[] {
  if (!Array.isArray(bruto)) return [];
  const bons: SnippetDeTerminal[] = [];
  for (const item of bruto) {
    try {
      bons.push(validarSnippet(item));
    } catch {
      // Um item torto não pode levar a lista inteira junto.
    }
  }
  return bons.slice(0, MAX_SNIPPETS);
}
