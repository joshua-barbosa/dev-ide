// Acessibilidade: as regras que a IDE se cobra (T098).
//
// **Por que uma lista própria em vez de "rode o axe e não deixe passar nada".**
//
// O axe devolve dezenas de regras, e boa parte delas não se aplica a um editor:
// ele reclama de `region` (todo conteúdo dentro de uma marca de região) numa
// tela que é uma grade de painéis, e de contraste em texto que o TEMA DELE
// define — e o tema é escolha dele, não defeito.
//
// Passar tudo faria o teste falhar por coisas que ninguém vai consertar, e o
// destino de um teste assim é ser desligado. Uma lista curta do que importa
// AQUI é um teste que sobrevive.
//
// A lista é do que quebra o uso de verdade num editor operado por teclado:
// **botão sem nome** (o leitor de tela anuncia "botão"), **campo sem rótulo**,
// **imagem sem texto**, e **foco que não se vê**.

/** As regras do axe que esta IDE se cobra. */
export const REGRAS_COBRADAS: readonly string[] = [
  // Botão de ícone sem nome é o caso mais comum numa IDE: a barra inteira é
  // de ícones.
  'button-name',
  'link-name',
  'input-image-alt',
  'image-alt',
  // Campo sem rótulo: o formulário de conexão é feito deles.
  'label',
  'form-field-multiple-labels',
  // `aria-*` inventado ou em elemento que não aceita: mente para o leitor de
  // tela, que é pior que não ter.
  'aria-valid-attr',
  'aria-valid-attr-value',
  'aria-required-attr',
  'aria-roles',
  // Um `id` repetido faz `aria-labelledby` apontar para o elemento errado.
  'duplicate-id-aria',
];

/**
 * Regras deliberadamente FORA, cada uma com o motivo.
 *
 * Existe para a lista de cima não parecer arbitrária: o que ficou de fora ficou
 * por uma razão escrita, e não por ter dado trabalho.
 */
export const REGRAS_DISPENSADAS: Readonly<Record<string, string>> = {
  region: 'A tela é uma grade de painéis redimensionáveis, e não um documento ' +
    'com cabeçalho e artigo. Marcar cada painel como região faria o leitor de ' +
    'tela anunciar seis regiões vazias antes do código.',
  'color-contrast': 'O contraste vem do TEMA, que é escolha dele (T013). Uma ' +
    'regra aqui reprovaria um tema que ele escolheu de propósito.',
  'scrollable-region-focusable': 'O editor e a grade tratam teclado por conta ' +
    'própria, com atalhos próprios; um `tabIndex` a mais só acrescentaria uma ' +
    'parada no Tab sem dar navegação nova.',
  'landmark-one-main': 'Mesma razão do `region`: não há um "conteúdo principal" ' +
    'numa tela em que editor, terminal, árvore e grade têm o mesmo peso e ' +
    'convivem ao mesmo tempo.',
  'page-has-heading-one': 'Não é um documento: não há título de página a ter, e ' +
    'inventar um `<h1>` invisível só para satisfazer a regra é enganar o teste ' +
    'em vez de ajudar quem usa leitor de tela.',
};

export interface Violacao {
  readonly regra: string;
  readonly descricao: string;
  readonly alvos: readonly string[];
}

/**
 * A mensagem de falha, com o SELETOR de cada elemento.
 *
 * "1 violação de button-name" não deixa ninguém consertar nada. O seletor sim —
 * é o que se cola no console para achar o botão.
 */
export function relatorio(violacoes: readonly Violacao[]): string {
  if (violacoes.length === 0) return 'Nenhuma violação.';
  return violacoes
    .map((v) => `• ${v.regra}: ${v.descricao}\n  ${v.alvos.join('\n  ')}`)
    .join('\n');
}

/** Nenhuma regra pode estar nas duas listas — seria uma contradição calada. */
export function conflitos(): readonly string[] {
  return REGRAS_COBRADAS.filter((r) => r in REGRAS_DISPENSADAS);
}
