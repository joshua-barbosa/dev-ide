// Orçamento de desempenho: o que não pode crescer sem alguém decidir (T098).
//
// **Um teto não é uma meta.** Nenhum destes números diz "está bom"; eles dizem
// "passou disto sem ninguém notar". A diferença importa: um orçamento apertado
// demais vira teste que se atualiza no reflexo, e aí ele não guarda mais nada.
//
// Os valores saem da MEDIDA de hoje, com folga declarada. Quando um estourar,
// a resposta certa é olhar o que cresceu — e, se o crescimento for legítimo,
// subir o número **junto com o motivo**, aqui.

export interface Orcamento {
  readonly nome: string;
  readonly limite: number;
  readonly unidade: 'bytes' | 'ms';
  /** Por que este número, e não outro. */
  readonly porque: string;
}

const MB = 1024 * 1024;

/**
 * O que o navegador precisa baixar para a IDE aparecer.
 *
 * O `index` é o que atrasa a PRIMEIRA pintura. Os workers do Monaco pesam mais
 * que ele somados, mas são baixados depois e só quando a linguagem entra —
 * medi-los junto misturaria duas coisas com custos diferentes.
 */
export const ORCAMENTOS: readonly Orcamento[] = [
  {
    nome: 'index',
    limite: 7 * MB,
    unidade: 'bytes',
    porque:
      'Medido em 02/09/2026: 5,5 MB. O teto dá ~25% de folga. É grande porque o ' +
      'Monaco inteiro está aqui dentro; separá-lo é trabalho de verdade e não ' +
      'de orçamento — mas dobrar de tamanho sem ninguém ver, não.',
  },
  {
    nome: 'assets',
    limite: 26 * MB,
    unidade: 'bytes',
    porque:
      'Medido: 20 MB com todos os workers e as linguagens do Monaco. O teto ' +
      'existe para pegar uma dependência pesada entrando de carona.',
  },
  {
    nome: 'ide-pronta',
    limite: 5_000,
    unidade: 'ms',
    porque:
      'Da navegação até a árvore de arquivos responder. MEDIDO em 02/09/2026: ' +
      '710 ms. O primeiro teto que escrevi foi 12 s, e ele não pegava nada — um ' +
      'teto dezessete vezes maior que a medida é enfeite. 5 s dá sete vezes de ' +
      'folga, que é o bastante para a suíte disputar a máquina sem falhar à toa.',
  },
];

/** Formata para a mensagem de falha ser lida sem contar zeros. */
export function emPalavras(valor: number, unidade: 'bytes' | 'ms'): string {
  if (unidade === 'ms') return `${Math.round(valor)} ms`;
  if (valor >= MB) return `${(valor / MB).toFixed(2)} MB`;
  return `${Math.round(valor / 1024)} kB`;
}

/**
 * A mensagem de estouro, com o quanto passou e o que fazer.
 *
 * Existe porque "esperado < 7340032, recebido 7500000" não diz a ninguém o que
 * decidir. A mensagem tem de dizer que a escolha é subir o número com um motivo
 * ou desfazer o que cresceu.
 */
export function mensagemDeEstouro(o: Orcamento, medido: number): string {
  const excesso = ((medido / o.limite - 1) * 100).toFixed(1);
  return [
    `O orçamento "${o.nome}" estourou: ${emPalavras(medido, o.unidade)} contra o ` +
      `teto de ${emPalavras(o.limite, o.unidade)} (${excesso}% acima).`,
    `Por que este teto: ${o.porque}`,
    'Se o crescimento for legítimo, suba o número em `shared/orcamento.ts` JUNTO ' +
      'com o motivo. Subir calado transforma o orçamento em enfeite.',
  ].join('\n');
}

export function dentroDoOrcamento(o: Orcamento, medido: number): boolean {
  return medido <= o.limite;
}

export function orcamentoDe(nome: string): Orcamento {
  const achado = ORCAMENTOS.find((o) => o.nome === nome);
  if (achado === undefined) throw new Error(`Orçamento desconhecido: ${nome}`);
  return achado;
}
