// Caminho de arquivo DA MÁQUINA onde a IDE roda.
//
// Existe porque a interface perguntava `caminho.startsWith(raiz + '/')`, e no
// Windows o servidor devolve `C:\proj\src` — a resposta era sempre não, a
// árvore nunca recebia os filhos e o painel entrava em laço de pedidos (D223).
//
// **Caminho REMOTO não passa por aqui.** SFTP, SSH e ZIP são POSIX por
// protocolo, mesmo com a IDE rodando no Windows; para esses vale
// `shared/remoto/caminho.ts`, que separa por barra e ponto final.
//
// Nada aqui lê o sistema: a plataforma é argumento, como em `plataforma.ts`.
// É o que deixa o comportamento do Windows testável numa máquina Linux.
import type { Plataforma } from './plataforma';

/** O separador que a plataforma ESCREVE. No Windows ela também aceita `/`. */
export function separadorDe(plataforma: Plataforma): '/' | '\\' {
  return plataforma === 'win32' ? '\\' : '/';
}

/**
 * Os caracteres que separam pedaços de caminho nesta plataforma.
 *
 * No Windows são dois: o `\` que ele escreve e a `/` que ele aceita — o próprio
 * Node trata as duas assim. No Unix é só a barra, e isso importa: `\` é nome de
 * arquivo perfeitamente válido no Linux, e tratá-lo como separador partiria o
 * caminho de quem tem um arquivo assim.
 */
function separadores(plataforma: Plataforma): readonly string[] {
  return plataforma === 'win32' ? ['\\', '/'] : ['/'];
}

/**
 * `filho` está abaixo de `pai`?
 *
 * A pasta NÃO está dentro dela mesma: quem precisa do "igual ou dentro" faz a
 * igualdade à parte, porque os dois casos costumam ter tratamentos diferentes
 * — enxertar na raiz não é enxertar num nó dela.
 *
 * Compara pedaço a pedaço, e não por prefixo de texto: `/abc` começa com `/ab`
 * sem estar dentro dele.
 */
export function dentroDe(pai: string, filho: string, plataforma: Plataforma): boolean {
  if (pai === '') return false;
  const seps = separadores(plataforma);
  // Uma raiz pode já terminar em separador (`C:\`, `/`); dois seguidos não
  // podem virar um pedaço vazio.
  const semFim = seps.includes(pai.slice(-1)) ? pai.slice(0, -1) : pai;
  if (!filho.startsWith(semFim)) return false;
  const resto = filho.slice(semFim.length);
  return resto.length > 0 && seps.includes(resto[0] as string);
}

/** Uma unidade do Windows: `C:`, `D:`. */
const UNIDADE = /^[a-zA-Z]:$/;

/** O último pedaço do caminho. Uma raiz sem nome acima dela devolve a si mesma. */
export function nomeDoCaminho(caminho: string, plataforma: Plataforma): string {
  const seps = separadores(plataforma);
  const pedacos = partir(caminho, seps).filter((p) => p !== '');
  const nome = pedacos[pedacos.length - 1] ?? caminho;
  // A raiz de uma unidade se chama `C:\\`, e não `C:` — sem a barra o texto
  // deixa de ser um caminho e vira o nome de uma unidade relativa.
  if (plataforma === 'win32' && pedacos.length === 1 && UNIDADE.test(nome)) return `${nome}\\`;
  return nome;
}

/** O que vem antes do último separador, ou `''` quando não há nenhum. */
export function pastaDoCaminho(caminho: string, plataforma: Plataforma): string {
  const seps = separadores(plataforma);
  for (let i = caminho.length - 1; i >= 0; i -= 1) {
    if (seps.includes(caminho[i] as string)) return caminho.slice(0, i);
  }
  return '';
}

/** Os pedaços do caminho, separados como esta plataforma separa. */
export function pedacos(caminho: string, plataforma: Plataforma): string[] {
  return partir(caminho, separadores(plataforma));
}

function partir(caminho: string, seps: readonly string[]): string[] {
  const pedacos: string[] = [];
  let atual = '';
  for (const c of caminho) {
    if (seps.includes(c)) {
      pedacos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  pedacos.push(atual);
  return pedacos;
}

/**
 * O nome de um caminho local **para mostrar na tela**, sem saber a plataforma.
 *
 * Deduz o separador do próprio caminho: só o Windows tem `C:\` e `\\servidor`,
 * e no Unix um caminho absoluto começa com `/`. É a única função daqui que
 * deduz, e a troca é consciente — são dezenas de rótulos (título de aba, linha
 * de resultado de busca, item do histórico) e nenhum deles tem a plataforma à
 * mão. Errar aqui mostra um nome esquisito; no Windows, NÃO deduzir mostrava
 * `C:\proj\src\a.ts` em toda aba.
 *
 * **Nunca use isto para decidir coisa alguma** — pertencimento, permissão,
 * enxerto na árvore. Para isso existe `dentroDe`, que recebe a plataforma.
 */
export function nomeParaExibir(caminho: string): string {
  return nomeDoCaminho(caminho, pareceWindows(caminho) ? 'win32' : 'linux');
}

/** A pasta de um caminho local **para mostrar na tela**. Ver `nomeParaExibir`. */
export function pastaParaExibir(caminho: string): string {
  return pastaDoCaminho(caminho, pareceWindows(caminho) ? 'win32' : 'linux');
}

/** `C:\…`, `c:/…` ou `\\servidor\…` — nenhum caminho Unix se parece com isso. */
function pareceWindows(caminho: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(caminho) || caminho.startsWith('\\\\');
}
