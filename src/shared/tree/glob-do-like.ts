// O filtro da árvore, traduzido para o glob que o Redis entende.
//
// O campo de filtro é um só para a árvore inteira, e ele fala `LIKE`: `%` é
// "qualquer coisa" e `_` é "um caractere". O `SCAN` do Redis fala glob: `*` e
// `?`. Sem esta tradução, filtrar `turmas` num banco de chave-valor mandaria
// `MATCH %turmas%` — que casa com chave nenhuma, em silêncio.
//
// A tradução também PROTEGE: `*`, `?`, `[` e `]` digitados por ele são literais
// no `LIKE`, e virariam curinga no glob. Escapá-los é o que faz uma chave
// chamada `fila[1]` ser encontrada pelo próprio nome.

/** O que o glob do Redis trata como especial e precisa de barra invertida. */
const ESPECIAIS_DO_GLOB = /[*?[\]\\^]/g;

/**
 * `%` vira `*`, `_` vira `?`, e o resto vira literal.
 *
 * `\%` e `\_` do `LIKE` são o escape dele: viram `%` e `_` literais.
 */
export function globDoLike(padrao: string): string {
  let saida = '';
  for (let i = 0; i < padrao.length; i += 1) {
    const c = padrao[i];
    if (c === '\\' && i + 1 < padrao.length) {
      // Escape do LIKE: o próximo caractere é literal, venha ele qual for.
      const proximo = padrao[i + 1] ?? '';
      saida += proximo.replace(ESPECIAIS_DO_GLOB, (m) => `\\${m}`);
      i += 1;
      continue;
    }
    if (c === '%') { saida += '*'; continue; }
    if (c === '_') { saida += '?'; continue; }
    saida += (c ?? '').replace(ESPECIAIS_DO_GLOB, (m) => `\\${m}`);
  }
  return saida;
}
