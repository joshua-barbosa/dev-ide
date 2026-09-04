// A árvore de grupos vista como lista.
//
// Os grupos existem para a tela; quem precisa PERGUNTAR "contra qual conexão?"
// quer todas elas, de todos os níveis. Mora aqui, e não em quem pergunta,
// porque já eram duas cópias da mesma travessia — e é assim que uma delas
// passa a esquecer os subgrupos sem ninguém notar.
import type { GroupNode, PublicConnection } from '../contracts';

/** Todas as conexões, na ordem da tela: as do nível antes das dos subgrupos. */
export function achatarConexoes(raiz: GroupNode): readonly PublicConnection[] {
  return [...raiz.connections, ...raiz.groups.flatMap(achatarConexoes)];
}
