// O que está aberto na árvore de conexões, e o que sai ao desconectar.
//
// Nasceu de um defeito que ele encontrou usando: **desconectar uma conexão
// derrubava a árvore de todas.** O servidor sempre fechou só a pedida; o
// estrago era do cliente, que zerava o cache de filhos inteiro em vez de tirar
// só o que era daquela conexão.
//
// Mora em `shared` porque é manipulação de chave — a parte que erra em
// silêncio, e que se confere sem navegador.

/** O separador das partes de uma chave. Não aparece em nome de objeto. */
export const SEPARADOR = '\u0000';

/** A chave do cache de filhos: conexão mais caminho até o nó. */
export function chaveDoNo(id: string, caminho: readonly string[]): string {
  return [id, ...caminho].join(SEPARADOR);
}

/**
 * As chaves de expansão que NÃO são desta conexão.
 *
 * Duas famílias convivem no mesmo conjunto: `conn:<id>` para o nó da conexão e
 * `no:<id>\0<caminho>` para os de dentro. As duas precisam sair juntas — deixar
 * as de dentro faria a árvore, ao reconectar, tentar reabrir ramos sem filhos e
 * disparar uma busca por nó de uma vez só.
 */
export function expansoesSemAConexao(
  expandidos: ReadonlySet<string>,
  id: string
): Set<string> {
  const daConexao = new Set([`conn:${id}`, `no:${id}`]);
  const prefixo = `no:${id}${SEPARADOR}`;
  const proximo = new Set<string>();
  for (const chave of expandidos) {
    if (daConexao.has(chave) || chave.startsWith(prefixo)) continue;
    proximo.add(chave);
  }
  return proximo;
}

/**
 * O cache de filhos sem o que é desta conexão.
 *
 * **A comparação é por prefixo COM o separador**, e não `startsWith(id)`: duas
 * conexões chamadas `servidor-1` e `etapa2` compartilhariam prefixo, e desconectar a
 * primeira apagaria a árvore da segunda — o mesmo defeito de novo, menor e mais
 * difícil de ver.
 */
export function filhosSemAConexao<T>(
  filhos: ReadonlyMap<string, T>,
  id: string
): Map<string, T> {
  const prefixo = `${id}${SEPARADOR}`;
  const proximo = new Map<string, T>();
  for (const [chave, valor] of filhos) {
    if (chave === id || chave.startsWith(prefixo)) continue;
    proximo.set(chave, valor);
  }
  return proximo;
}
