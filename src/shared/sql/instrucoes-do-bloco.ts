// As instruções de um bloco do caderno, uma por Results (spec 111).
//
// Ele (30/09): *"se tem mais de uma query (e é bem nitido que tem, pois termina
// com ; cada query), deveria rodar e gerar uma tela "Results" para cada
// query"*. Antes o bloco ia inteiro numa chamada só, e o MySQL o recusava — de
// propósito: a conexão tem `multipleStatements: false`, para um trecho colado
// não rodar DDL escondida. Partir aqui mantém essa trava e dá a ele o que pediu.
//
// Quem parte é `quebrarEmStatements`, o mesmo do editor: respeita aspas, `$$` e
// corpo de procedure. Partir com `split(';')` mandaria meia query ao banco.
import { quebrarEmStatements } from './statements';

/** Qual instrução de um bloco com várias é esta. */
export interface ParteDoBloco {
  readonly indice: number;
  readonly total: number;
}

export interface InstrucoesDoBloco {
  readonly instrucoes: readonly string[];
  /** Quando não dá para partir com segurança, o motivo — e nada roda. */
  readonly erro: string | null;
}

export function instrucoesDoBloco(conteudo: string): InstrucoesDoBloco {
  if (conteudo.trim() === '') return { instrucoes: [], erro: null };
  const quebra = quebrarEmStatements(conteudo);
  if (quebra.truncado) {
    return {
      instrucoes: [],
      erro: `O bloco tem instruções demais (mais de ${quebra.statements.length}). Divida-o em blocos menores.`,
    };
  }
  // Uma só vai INTACTA: é o comportamento de sempre, com comentário e tudo.
  if (quebra.statements.length <= 1) return { instrucoes: [conteudo], erro: null };
  return { instrucoes: quebra.statements.map((s) => s.texto), erro: null };
}

/** O nome da aba de Results: diz QUAL instrução é, quando há mais de uma. */
export function tituloDaInstrucao(titulo: string, indice: number, total: number): string {
  return total <= 1 ? titulo : `${titulo} · ${indice + 1}/${total}`;
}

/**
 * A vaga do resultado de uma instrução, para quem guarda resultado por arquivo.
 *
 * Sem parte, a vaga é a de sempre. Com parte, cada instrução tem a sua — e
 * rodar o bloco de novo repinta as MESMAS, em vez de empilhar abas.
 */
export function vagaDaInstrucao(base: string, parte?: ParteDoBloco): string {
  return parte === undefined ? base : `${base}:${parte.indice + 1}/${parte.total}`;
}
