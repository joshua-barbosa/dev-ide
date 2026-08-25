// A largura de cada coluna da grade (spec 062, fase C).
//
// Lógica pura porque arrastar é fácil de errar de um jeito que teste de tela não
// pega: o que se guarda é a largura RESULTANTE, e não o quanto o mouse andou.
// Se guardássemos o delta, dois arrastos seguidos somariam errado quando o
// primeiro tivesse batido no mínimo.

/** Abaixo disto a coluna vira uma tira sem conteúdo legível. */
export const LARGURA_MINIMA = 48;

/**
 * O TETO da largura AUTOMÁTICA.
 *
 * Era o teto absoluto (`maxWidth`) até a spec 062: uma coluna `longtext` de
 * JSON ficava presa em 420 px com reticências e não havia como ler o valor.
 * Agora limita só o palpite inicial — arrastar passa dele à vontade.
 *
 * O que ele NÃO é: a largura com que toda coluna nasce. Foi o que eu fiz
 * primeiro, e no navegador ficou evidente o estrago — `id`, `portal` e
 * `user_id` ganharam 420 px cada uma, e onde cabiam dez colunas passaram a
 * caber quatro. Coluna nasce do tamanho do que ela mostra.
 */
export const TETO_AUTOMATICO = 420;

export type Larguras = Readonly<Record<string, number>>;

/** O que o arrasto produz: largura de origem + quanto o mouse andou. */
export function aoArrastar(inicial: number, deltaX: number): number {
  return Math.max(LARGURA_MINIMA, Math.round(inicial + deltaX));
}

/** Devolve o MESMO objeto quando nada muda: React não repinta à toa. */
export function definir(atual: Larguras, coluna: string, largura: number): Larguras {
  const nova = Math.max(LARGURA_MINIMA, Math.round(largura));
  if (atual[coluna] === nova) return atual;
  return { ...atual, [coluna]: nova };
}

/** Esquecer uma coluna: ela volta a se dimensionar sozinha. */
export function esquecer(atual: Larguras, coluna: string): Larguras {
  if (!(coluna in atual)) return atual;
  const { [coluna]: _fora, ...resto } = atual;
  return resto;
}

/**
 * A largura que cabe o conteúdo, para o duplo clique na alça.
 *
 * Mede pelo TEXTO, e não pelo DOM: medir no DOM exigiria tirar o
 * `text-overflow` de cada célula, deixar o navegador refazer o arranjo e ler de
 * volta — três repinturas numa tabela de 500 linhas. Aqui é uma conta.
 *
 * `porCaractere` vem de quem chama porque depende da fonte de verdade na tela;
 * a interface mede uma vez e passa.
 */
export function larguraDoConteudo(
  textos: readonly string[],
  porCaractere: number,
  respiro = 24
): number {
  const maior = textos.reduce((m, t) => Math.max(m, t.length), 0);
  return Math.min(
    TETO_AUTOMATICO,
    Math.max(LARGURA_MINIMA, Math.ceil(maior * porCaractere) + respiro)
  );
}
