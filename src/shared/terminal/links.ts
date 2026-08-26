// O que num terminal é clicável (T109 · spec 008).
//
// Duas coisas diferentes, e por isso duas funções:
//   - URL, que o navegador abre;
//   - `caminho:linha`, que a IDE abre no editor.
//
// O segundo é o que aparece em traceback de Python, saída de `tsc`, `grep -n`,
// `eslint` e mensagem de compilador — e é o que torna a saída do terminal
// navegável em vez de só legível. Encosta no T008, o *problem matcher*: a
// diferença é que lá o padrão é POR COMANDO, e aqui vale para qualquer texto.

/** Um trecho clicável dentro de uma linha. */
export interface Alvo {
  readonly inicio: number;
  readonly fim: number;
  readonly tipo: 'url' | 'arquivo';
  /** O caminho, sem a linha e a coluna. Só em `arquivo`. */
  readonly caminho?: string;
  readonly linha?: number;
  readonly coluna?: number;
}

/**
 * Caminho seguido de `:linha` e, às vezes, `:coluna`.
 *
 * Precisa ter BARRA ou começar com `.`: sem isso, `erro:12` numa frase comum
 * viraria link para um arquivo chamado "erro". Um link que não abre nada é pior
 * que texto — some ao clicar e não faz nada.
 */
const ARQUIVO = /(?:^|[\s"'`(\[])((?:\.{1,2}\/|\/|[\w.@-]+\/)[\w./@+-]*[\w.@+-])(?::(\d+))(?::(\d+))?/g;

/** `http://` e `https://`, parando antes da pontuação que fecha a frase. */
const URL_NA_LINHA = /\bhttps?:\/\/[^\s<>"'`)\]]+/g;

/** Pontuação que quase sempre é da FRASE, e não do endereço. */
const FIM_DE_FRASE = /[.,;:!?]+$/;

export function acharAlvos(linha: string): readonly Alvo[] {
  const alvos: Alvo[] = [];

  for (const m of linha.matchAll(URL_NA_LINHA)) {
    const bruto = m[0];
    // `Veja em http://localhost:3000.` — o ponto final é da frase. Um parêntese
    // de fechamento também, quando não há o de abertura dentro.
    const limpo = bruto.replace(FIM_DE_FRASE, '');
    alvos.push({ inicio: m.index, fim: m.index + limpo.length, tipo: 'url' });
  }

  for (const m of linha.matchAll(ARQUIVO)) {
    const caminho = m[1];
    if (caminho === undefined) continue;
    // Não marca de novo o que já é URL: `http://x/a.ts:3` casaria nos dois.
    const inicio = m.index + m[0].indexOf(caminho);
    if (alvos.some((a) => inicio >= a.inicio && inicio < a.fim)) continue;
    alvos.push({
      inicio,
      fim: inicio + (m[0].length - m[0].indexOf(caminho)),
      tipo: 'arquivo',
      caminho,
      linha: Number(m[2]),
      ...(m[3] === undefined ? {} : { coluna: Number(m[3]) }),
    });
  }

  return alvos.sort((a, b) => a.inicio - b.inicio);
}
