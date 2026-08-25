// Caminho de servidor remoto (spec 052).
//
// **Não é `node:path`.** O `path` do Node fala o dialeto da máquina onde a IDE
// roda: no Windows ele trata barra invertida como separador e entende `C:`. Um
// caminho de SFTP é sempre POSIX, venha de onde vier — e um arquivo Linux pode
// legitimamente ter barra invertida no nome. Usar `path.join` aqui quebraria
// esse arquivo em dois níveis no dia em que a IDE rodasse no Windows, que é
// exatamente o tipo de defeito que não aparece na máquina de quem escreveu.
//
// Aqui também mora a **cerca do `Prune Root`** (D23). Ela é a razão de este
// módulo ser puro e testado: uma fronteira que só existe na tela não é uma
// fronteira.

/**
 * O que nenhum componente de caminho pode conter.
 *
 * Escrito com escape, e não com o caractere: um NUL literal no código-fonte é
 * invisível na tela, sobrevive a uma revisão de olho e quebra ferramenta que
 * lê o arquivo como texto. O projeto já tem guarda contra isso.
 */
const PROIBIDO = ['/', '\u0000'];

/**
 * Reduz um caminho à forma canônica: absoluto, sem `//`, sem `.`, sem `..`.
 *
 * `..` é resolvido AQUI, e não deixado para o servidor, porque a cerca compara
 * o resultado — e comparar antes de resolver deixaria `/srv/app/../../etc`
 * passar por parecer que começa com `/srv/app`.
 */
export function normalizarRemoto(bruto: string): string {
  const pilha: string[] = [];
  for (const parte of bruto.split('/')) {
    if (parte === '' || parte === '.') continue;
    if (parte === '..') {
      // Subir da raiz para na raiz. Um `/..` não existe em lugar nenhum, e
      // devolvê-lo faria a cerca comparar uma coisa que o servidor não tem.
      pilha.pop();
      continue;
    }
    pilha.push(parte);
  }
  return `/${pilha.join('/')}`.replace(/^\/\/+/, '/');
}

/** A pasta acima. A raiz é o próprio pai — não há para onde subir. */
export function paiDe(caminho: string): string {
  const limpo = normalizarRemoto(caminho);
  if (limpo === '/') return '/';
  const corte = limpo.lastIndexOf('/');
  return corte <= 0 ? '/' : limpo.slice(0, corte);
}

/** O último componente. Da raiz, a própria raiz. */
export function nomeDe(caminho: string): string {
  const limpo = normalizarRemoto(caminho);
  if (limpo === '/') return '/';
  return limpo.slice(limpo.lastIndexOf('/') + 1);
}

export function juntar(base: string, ...partes: readonly string[]): string {
  return normalizarRemoto([base, ...partes].join('/'));
}

/**
 * O caminho está dentro da raiz? (AC-13)
 *
 * Compara **componente**, e não prefixo de texto: `/srv/app2` começa com
 * `/srv/app` e não está dentro dele. É o mesmo cuidado do `arquivoDe` da spec
 * 038 — lá o defeito seria vazar arquivo de outra conexão, aqui seria furar o
 * `Prune Root` e listar o servidor inteiro.
 */
export function dentroDaRaiz(raiz: string, caminho: string): boolean {
  const r = normalizarRemoto(raiz);
  const c = normalizarRemoto(caminho);
  if (r === '/') return true;
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Transforma o caminho do NÓ (uma lista de nomes) num caminho absoluto,
 * conferindo a cerca — ou devolve `null`.
 *
 * Cada componente é conferido antes de ser juntado: um nome que contenha `/`
 * viraria dois níveis, e um que contenha NUL corta a string no meio do caminho
 * quando ela chega numa chamada de sistema. Os dois recusam.
 */
export function resolverDaRaiz(raiz: string, partes: readonly string[]): string | null {
  for (const parte of partes) {
    if (parte === '') return null;
    if (PROIBIDO.some((c) => parte.includes(c))) return null;
  }
  const alvo = juntar(raiz, ...partes);
  return dentroDaRaiz(raiz, alvo) ? alvo : null;
}

/** Começa com ponto. `.` e `..` não são arquivos ocultos — são navegação. */
export function ehOculto(nome: string): boolean {
  return nome.startsWith('.') && nome !== '.' && nome !== '..';
}
