// O filtro por coluna, com operadores (T057 · spec 041).
//
// Na spec 041 eu escrevi que "`contém` cobre o uso diário" e deixei o resto de
// fora. Cobria o meu palpite sobre o dia dele; ele resgatou da lista dos 114.
//
// Puro, e compartilhado de propósito: o SERVIDOR usa para montar o `WHERE`, e a
// TELA usa para dizer o que entendeu do que foi digitado. Duas implementações da
// mesma gramática divergiriam, e a divergência apareceria como "filtrei e veio
// coisa errada" — silenciosa e cara.

export type Operador =
  | 'contem'
  | 'igual'
  | 'diferente'
  | 'maior'
  | 'maiorOuIgual'
  | 'menor'
  | 'menorOuIgual'
  | 'nulo'
  | 'naoNulo'
  | 'entre';

export interface FiltroInterpretado {
  readonly operador: Operador;
  /** Zero valores em `nulo`/`naoNulo`, dois em `entre`, um no resto. */
  readonly valores: readonly string[];
}

/** Como cada operador se lê em português, para a dica na tela. */
export const COMO_SE_LE: Readonly<Record<Operador, string>> = {
  contem: 'contém',
  igual: 'igual a',
  diferente: 'diferente de',
  maior: 'maior que',
  maiorOuIgual: 'maior ou igual a',
  menor: 'menor que',
  menorOuIgual: 'menor ou igual a',
  nulo: 'é nulo',
  naoNulo: 'não é nulo',
  entre: 'entre',
};

/**
 * A ordem IMPORTA: `>=` antes de `>`, senão `>=10` viraria "maior que `=10`".
 * É o erro clássico de quem escreve isto com um `switch` no primeiro caractere.
 */
const PREFIXOS: readonly (readonly [string, Operador])[] = [
  ['>=', 'maiorOuIgual'],
  ['<=', 'menorOuIgual'],
  ['<>', 'diferente'],
  ['!=', 'diferente'],
  ['>', 'maior'],
  ['<', 'menor'],
  ['=', 'igual'],
];

const NULOS = new Set(['null', 'nulo', 'nulo?']);

/**
 * Lê o que o usuário digitou.
 *
 * Texto sem sinal continua sendo `contém` — é o que a caixa fazia antes desta
 * feature, e mudar isso quebraria o dedo de quem já usa.
 *
 * Escapes, para quem PRECISA procurar o texto literal:
 *   - `=null` procura a palavra "null", e não o valor nulo;
 *   - `=1..5` procura o texto "1..5", e não o intervalo.
 * Ou seja: `=` é o "quero exatamente isto" em todos os casos.
 */
export function interpretarFiltro(bruto: string): FiltroInterpretado | null {
  const texto = bruto.trim();
  if (texto === '') return null;

  const minusculo = texto.toLowerCase();
  if (NULOS.has(minusculo)) return { operador: 'nulo', valores: [] };
  if (minusculo.startsWith('!') && NULOS.has(minusculo.slice(1).trim())) {
    return { operador: 'naoNulo', valores: [] };
  }

  for (const [prefixo, operador] of PREFIXOS) {
    if (!texto.startsWith(prefixo)) continue;
    const resto = texto.slice(prefixo.length).trim();
    // `>` sozinho não é filtro, é meio caminho — e filtrar por string vazia
    // devolveria a tabela inteira sem o usuário entender por quê.
    if (resto === '') return null;
    return { operador, valores: [resto] };
  }

  // Intervalo por último: `1..5`, `2024-01-01..2024-12-31`. Fechado dos dois
  // lados, que é como o `BETWEEN` do SQL funciona e como se lê "de A até B".
  const partes = texto.split('..');
  if (partes.length === 2) {
    const [de, ate] = partes.map((p) => p.trim());
    if (de !== undefined && ate !== undefined && de !== '' && ate !== '') {
      return { operador: 'entre', valores: [de, ate] };
    }
  }

  return { operador: 'contem', valores: [texto] };
}

/** A dica que a tela mostra embaixo da caixa, para quem digitou algo estranho. */
export function explicarFiltro(bruto: string): string | null {
  const f = interpretarFiltro(bruto);
  if (f === null) return null;
  if (f.operador === 'contem') return null; // o padrão não precisa de explicação
  if (f.valores.length === 0) return COMO_SE_LE[f.operador];
  return `${COMO_SE_LE[f.operador]} ${f.valores.join(' e ')}`;
}
