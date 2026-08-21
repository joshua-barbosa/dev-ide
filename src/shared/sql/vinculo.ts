// O vínculo de um arquivo `.sql` com uma conexão e um database.
//
// A ideia veio das anotações do usuário sobre a ferramenta que ele usa hoje: um
// `.sql` de lá não pergunta contra quem roda — ele já sabe, porque mora numa
// pasta cujo nome carrega a conexão e o database. É isso que faz aparecer um
// `Run` acima de cada query, sem nenhum seletor no caminho.
//
// Aqui mora só a parte que é decidível olhando o CAMINHO. O que foi escolhido à
// mão mora no servidor (`queries.json`), e a regra de precedência é do gancho da
// interface: caminho primeiro, lembrança depois, pergunta por último.

/** Nome da pasta, sob a raiz de dados, onde as queries por conexão moram. */
export const PASTA_DE_QUERIES = 'query';

export interface Vinculo {
  readonly connectionId: string;
  readonly database: string;
}

/**
 * Separador entre a conexão e o database no nome da pasta.
 *
 * `@` e não `-` porque id de conexão e nome de database podem conter hífen, e um
 * separador que aparece dos dois lados não separa nada.
 */
const SEPARADOR = '@';

/**
 * Codifica um pedaço para virar nome de pasta.
 *
 * O id da conexão é nosso e é seguro; o nome do database vem do banco e pode ter
 * qualquer coisa — `/`, `..`, espaço, acento. `encodeURIComponent` deixa tudo
 * plano e é reversível, que é o que importa para `vinculoDoCaminho` conseguir
 * ler de volta.
 */
function codificar(pedaco: string): string {
  return encodeURIComponent(pedaco).replace(/\*/g, '%2A');
}

function decodificar(pedaco: string): string | null {
  try {
    return decodeURIComponent(pedaco);
  } catch {
    // Sequência `%` malformada: não é pasta nossa, e fingir que é seria pior.
    return null;
  }
}

/** Nome da pasta de uma conexão+database. Não inclui a raiz. */
export function pastaDoVinculo(vinculo: Vinculo): string {
  return `${codificar(vinculo.connectionId)}${SEPARADOR}${codificar(vinculo.database)}`;
}

/**
 * Lê o vínculo de volta de um nome de pasta.
 *
 * Devolve `null` para nome que não segue o formato — a pasta pode ter sido
 * criada à mão, e adivinhar dali daria um vínculo errado em silêncio.
 */
export function vinculoDaPasta(nome: string): Vinculo | null {
  const corte = nome.indexOf(SEPARADOR);
  if (corte <= 0 || corte === nome.length - 1) return null;
  const connectionId = decodificar(nome.slice(0, corte));
  const database = decodificar(nome.slice(corte + 1));
  if (connectionId === null || database === null) return null;
  if (connectionId === '' || database === '') return null;
  return { connectionId, database };
}

/**
 * Deriva o vínculo do caminho do arquivo, quando ele mora sob a raiz de queries.
 *
 * `raiz` e `caminho` vêm normalizados de quem chama; a comparação é textual de
 * propósito, para esta função continuar pura e testável sem tocar em disco.
 */
export function vinculoDoCaminho(raiz: string, caminho: string): Vinculo | null {
  const prefixo = raiz.endsWith('/') ? raiz : `${raiz}/`;
  if (!caminho.startsWith(prefixo)) return null;
  const resto = caminho.slice(prefixo.length);
  const barra = resto.indexOf('/');
  // Precisa ser `<pasta>/<arquivo>`: solto na raiz não tem vínculo, e mais fundo
  // que um nível também não — a pasta do vínculo não tem subpastas.
  if (barra <= 0 || resto.indexOf('/', barra + 1) !== -1) return null;
  return vinculoDaPasta(resto.slice(0, barra));
}

/**
 * Um arquivo de query, como a rota devolve.
 *
 * Mora aqui, e não no servidor, pelo motivo de sempre: a interface não compila
 * `src/server`, e repetir a forma dos dois lados é como eles divergem calados.
 */
export interface ArquivoDeQuery {
  readonly nome: string;
  readonly caminho: string;
  readonly bytes: number;
  readonly modificadoEm: string;
}

export function mesmoVinculo(a: Vinculo | null, b: Vinculo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.connectionId === b.connectionId && a.database === b.database;
}
