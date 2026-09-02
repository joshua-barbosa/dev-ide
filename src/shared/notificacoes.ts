// Notificações empilháveis e o histórico da sessão (T107).
//
// A nota dele: *"empilham no canto, e um sino guarda o histórico da sessão"*.
//
// **Isto não substitui o diálogo.** A IDE já tem um `avisar` que INTERROMPE, e
// ele continua existindo para o que exige decisão: "este arquivo mudou no
// disco, o que fazer?". A notificação é para o que só precisa ser dito — "o
// arquivo foi salvo", "a conexão caiu" — e que hoje ou vira um diálogo demais,
// ou não vira nada.
//
// Este arquivo é a REGRA: quanto tempo cada tipo fica, quantas cabem na pilha, e
// o que o sino guarda. A tela obedece.

export type TipoDeAviso = 'info' | 'sucesso' | 'atencao' | 'erro';

export interface Aviso {
  readonly id: string;
  readonly quando: number;
  readonly tipo: TipoDeAviso;
  readonly mensagem: string;
  /** De onde veio — `git`, `conexão`, `terminal`. Vazio quando é da IDE. */
  readonly origem?: string;
}

/**
 * Quanto tempo cada tipo fica na tela, em milissegundos.
 *
 * **Erro não some sozinho.** Quem estava olhando para outro lado perderia
 * justamente o que precisava ler, e um erro que passa voando é pior que erro
 * nenhum: dá a sensação de que algo aconteceu sem dizer o quê.
 */
export const DURACAO: Readonly<Record<TipoDeAviso, number | null>> = {
  info: 4_000,
  sucesso: 3_000,
  atencao: 8_000,
  erro: null,
};

/** Quantas cabem empilhadas de uma vez. */
export const MAX_NA_PILHA = 4;

/** Quantas o sino guarda. A sessão inteira caberia, mas ninguém rola 500 itens. */
export const MAX_NO_HISTORICO = 100;

/**
 * Acrescenta um aviso à pilha visível.
 *
 * Quando a pilha enche, a mais VELHA sai — e não a nova é recusada: o aviso
 * recém-chegado é o que descreve o que acabou de acontecer, e é ele que a
 * pessoa está esperando ver.
 *
 * **Erro nunca é empurrado para fora por um aviso comum.** Quatro "arquivo
 * salvo" seguidos apagariam da tela o erro que veio antes deles, e é o erro que
 * precisava ser lido. Se todos forem erros, aí sim o mais velho sai.
 */
export function empilhar(pilha: readonly Aviso[], novo: Aviso): readonly Aviso[] {
  const com = [...pilha, novo];
  if (com.length <= MAX_NA_PILHA) return com;

  const descartavel = com.findIndex((a) => a.tipo !== 'erro');
  const fora = descartavel === -1 ? 0 : descartavel;
  return com.filter((_, i) => i !== fora);
}

/** O histórico do sino, do mais novo para o mais velho, com teto. */
export function noHistorico(historico: readonly Aviso[], novo: Aviso): readonly Aviso[] {
  return [novo, ...historico].slice(0, MAX_NO_HISTORICO);
}

/**
 * Quantos avisos NÃO LIDOS o sino mostra.
 *
 * Lido é o que já estava no histórico quando ele abriu o sino da última vez —
 * por isso a conta é por marca de tempo, e não por uma marca em cada aviso: um
 * campo `lido` obrigaria a reescrever a lista inteira a cada abertura.
 */
export function naoLidos(historico: readonly Aviso[], lidoAte: number): number {
  return historico.filter((a) => a.quando > lidoAte).length;
}

/**
 * O tipo que um erro vira.
 *
 * Existe para o `aoFalhar` da IDE inteira passar por um lugar só, e para o
 * cancelamento não virar erro: cancelar é escolha dele, e pintar de vermelho o
 * que ele mesmo pediu é acusar o usuário de um problema que não existe.
 */
export function tipoDoErro(mensagem: string): TipoDeAviso {
  return /\bcancelad[oa]\b/i.test(mensagem) ? 'info' : 'erro';
}
