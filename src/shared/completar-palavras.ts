// Completar pelas palavras do próprio arquivo (T114).
//
// A nota dele diz as duas metades: *"TS/JS pelo serviço do TypeScript; nas
// outras, **ao menos as palavras do arquivo aberto**"*.
//
// Esta é a segunda metade, e o "ao menos" é honesto: isto não entende a
// linguagem, não sabe o que é uma variável e não vai sugerir o método de um
// objeto. O que ele faz é o que o Vim e o Sublime fazem há vinte anos — oferecer
// o que já está escrito ali —, e isso resolve a maior parte do que se digita:
// nomes longos que se repetem.
//
// **Roda no navegador**, sem projeto e sem servidor: o texto já está na tela.

/**
 * O que conta como palavra.
 *
 * Letra, número, `_` e `$` — e acento entra, porque `configuração` é nome de
 * variável em código escrito em português, que é o caso dele. `\w` do
 * JavaScript não inclui acento, e por isso a classe é escrita à mão.
 */
const PALAVRA = /[A-Za-z0-9_$À-ɏḀ-ỿ]+/g;

/** Palavras com menos que isto não valem: ninguém precisa completar `id`. */
const MINIMO = 3;

/** Quantas voltam. O Monaco filtra sozinho, mas a lista atravessa o render. */
const MAX = 500;

export interface PalavraSugerida {
  readonly texto: string;
  /** Quantas vezes aparece — quem repete mais aparece antes. */
  readonly vezes: number;
}

/**
 * As palavras de um texto, das mais usadas para as menos.
 *
 * `exceto` tira a palavra que está sendo digitada AGORA: sem isso, digitar
 * `conf` sugeriria `conf`, que é o que já está lá — a sugestão mais inútil
 * possível, e a que aparece em primeiro lugar.
 *
 * O empate é desfeito por ordem alfabética, e isso importa: sem critério
 * estável, a mesma lista sairia em ordens diferentes a cada tecla, e a primeira
 * sugestão dançaria embaixo do dedo.
 */
export function palavrasDoTexto(texto: string, exceto = ''): readonly PalavraSugerida[] {
  const contagem = new Map<string, number>();
  for (const achada of texto.matchAll(PALAVRA)) {
    const palavra = achada[0];
    if (palavra.length < MINIMO) continue;
    // Número puro não é palavra: `2026` sugerido no meio do código é ruído.
    if (/^\d+$/.test(palavra)) continue;
    if (palavra === exceto) continue;
    contagem.set(palavra, (contagem.get(palavra) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([texto2, vezes]) => ({ texto: texto2, vezes }))
    .sort((a, b) => b.vezes - a.vezes || a.texto.localeCompare(b.texto))
    .slice(0, MAX);
}

/**
 * A palavra que está sendo digitada, olhando para trás a partir do cursor.
 *
 * Usada para o `exceto` acima, e para o Monaco saber o que substituir.
 */
export function palavraAntesDoCursor(linha: string, coluna: number): string {
  const antes = linha.slice(0, Math.max(0, coluna - 1));
  const achado = /[A-Za-z0-9_$À-ɏḀ-ỿ]+$/.exec(antes);
  return achado?.[0] ?? '';
}
