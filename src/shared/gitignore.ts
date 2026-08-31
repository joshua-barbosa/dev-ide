// Leitura de `.gitignore`, para decidir o que a IDE VARRE.
//
// **Varrer não é o mesmo que mostrar.** A árvore mostra tudo que existe no
// disco — `.venv`, `vendor`, `node_modules` inclusive —, porque esconder pasta
// é mentir sobre o projeto. O que estas regras governam é o outro lado: quais
// arquivos entram na busca, na extração de símbolos e no serviço de linguagem.
// Varrer `node_modules` não ajuda ninguém e custa segundos.
//
// Suporte deliberadamente PARCIAL. O `.gitignore` de verdade tem sintaxe farta;
// aqui está o que aparece na prática, e o que fica de fora está dito no fim.

/** Uma regra, já compilada. */
export interface Regra {
  readonly origem: string;
  readonly negada: boolean;
  /** Casa o próprio item. Numa regra `dist/`, só vale para pasta. */
  readonly proprio: RegExp | null;
  /** Casa o que está DENTRO do item. Vale para pasta e arquivo. */
  readonly dentro: RegExp;
  /** Como `proprio`, mas só quando o item É uma pasta (regra terminada em `/`). */
  readonly proprioSePasta?: RegExp;
}

/**
 * Lê uma classe de caractere (`[abc]`, `[a-z]`, `[!x]`) a partir do `[` em `i`.
 *
 * Devolve `null` quando não há fechamento — e aí o `[` é literal, como no git.
 *
 * Três bordas que os testes fixam:
 * - **`]` logo depois do `[` (ou do `!`) é literal**, e não fecha a classe;
 * - **`!` e `^` negam**; o git documenta o primeiro e aceita o segundo;
 * - **a barra nunca entra**, senão `a[b/c]d` viraria um padrão que atravessa
 *   pasta e ignoraria caminho fundo por engano.
 */
function lerClasse(padrao: string, i: number): { fonte: string; fim: number } | null {
  let j = i + 1;
  let negada = false;
  if (padrao[j] === '!' || padrao[j] === '^') {
    negada = true;
    j += 1;
  }

  let corpo = '';
  // `]` na primeira posição é literal: `[]]` é a classe que casa `]`.
  if (padrao[j] === ']') {
    corpo += '\\]';
    j += 1;
  }
  while (j < padrao.length && padrao[j] !== ']') {
    const c = padrao[j] as string;
    // O intervalo passa inteiro; o resto é escapado para não virar sintaxe.
    if (c === '-' && corpo !== '' && padrao[j + 1] !== ']') corpo += '-';
    else if (c === '\\') corpo += '\\\\';
    else corpo += c.replace(/[\]^\\]/g, '\\$&');
    j += 1;
  }
  if (j >= padrao.length) return null;

  // Sempre com a barra de fora: nem uma classe positiva pode casá-la.
  const fonte = negada ? `(?![/])[^${corpo}/]` : `(?![/])[${corpo}]`;
  return { fonte, fim: j };
}

/**
 * Traduz um padrão do `.gitignore` para expressão regular.
 *
 * As três diferenças que importam em relação a um glob comum:
 * - `*` não atravessa `/`; `**` atravessa.
 * - padrão SEM barra no meio casa em qualquer profundidade (`*.log` casa
 *   `a/b/c.log`); com barra, é ancorado na pasta do `.gitignore`.
 * - `/` no fim significa "só pasta".
 */
function compilar(bruto: string): Regra | null {
  let padrao = bruto.trim();
  if (padrao === '' || padrao.startsWith('#')) return null;

  const negada = padrao.startsWith('!');
  if (negada) padrao = padrao.slice(1);

  const soPasta = padrao.endsWith('/');
  if (soPasta) padrao = padrao.slice(0, -1);

  // Barra no início ancora; barra no meio também. Sem nenhuma, vale em
  // qualquer profundidade.
  const ancorado = padrao.startsWith('/') || padrao.slice(0, -1).includes('/');
  if (padrao.startsWith('/')) padrao = padrao.slice(1);
  if (padrao === '') return null;

  let fonte = '';
  for (let i = 0; i < padrao.length; i += 1) {
    const c = padrao[i]!;
    if (c === '*') {
      if (padrao[i + 1] === '*') {
        // `**/` come zero ou mais níveis; `**` sozinho come qualquer coisa.
        if (padrao[i + 2] === '/') {
          fonte += '(?:.*/)?';
          i += 2;
        } else {
          fonte += '.*';
          i += 1;
        }
      } else {
        fonte += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      fonte += '[^/]';
      continue;
    }
    if (c === '[') {
      const classe = lerClasse(padrao, i);
      if (classe !== null) {
        fonte += classe.fonte;
        i = classe.fim;
        continue;
      }
      // Colchete sem fechamento é caractere literal — é o que o git faz, em vez
      // de abrir uma classe que come o resto da linha.
    }
    fonte += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  // Sem âncora, o padrão pode começar em qualquer nível.
  const inicio = ancorado ? '^' : '^(?:.*/)?';
  // Duas perguntas diferentes, dois padrões: "é este item?" e "está dentro
  // dele?". Separá-los é o que faz `dist/` pegar a pasta e tudo que há nela,
  // sem pegar um ARQUIVO chamado `dist`.
  return {
    origem: bruto.trim(),
    negada,
    proprio: soPasta ? null : new RegExp(`${inicio}${fonte}$`),
    dentro: new RegExp(`${inicio}${fonte}/.+$`),
    ...(soPasta ? { proprioSePasta: new RegExp(`${inicio}${fonte}$`) } : {}),
  } as Regra;
}

export function lerRegras(conteudo: string): Regra[] {
  const regras: Regra[] = [];
  for (const linha of conteudo.split('\n')) {
    const regra = compilar(linha);
    if (regra !== null) regras.push(regra);
  }
  return regras;
}

/**
 * O que se ignora mesmo sem `.gitignore` nenhum.
 *
 * Não é opinião sobre organização de projeto: é o que **não se edita** e tem
 * milhares de arquivos. Um projeto sem `.gitignore` ainda não quer a busca
 * varrendo o `node_modules`.
 */
export const PADROES_PADRAO: readonly string[] = [
  'node_modules/',
  '.git/',
  '.hg/',
  '.svn/',
  // Python
  '.venv/', 'venv/', '__pycache__/', '.mypy_cache/', '.pytest_cache/', '.ruff_cache/', '.tox/',
  // PHP, Rust, Java
  'vendor/', 'target/',
  // JavaScript
  'dist/', '.next/', '.nuxt/', '.svelte-kit/', '.turbo/', '.parcel-cache/',
  // A própria IDE
  '.runs/',
];

export const REGRAS_PADRAO: readonly Regra[] = lerRegras(PADROES_PADRAO.join('\n'));

/**
 * Decide se um caminho RELATIVO à raiz deve ser varrido.
 *
 * A última regra que casa vence — é assim que `!` funciona no git, e é o que
 * permite `dist/` seguido de `!dist/manual.js`.
 *
 * @param relativo caminho com `/`, sem barra no início
 * @param ehPasta usado pelas regras terminadas em `/`
 */
export function ignorado(
  relativo: string,
  ehPasta: boolean,
  regras: readonly Regra[]
): boolean {
  let decisao = false;
  for (const regra of regras) {
    const proprio = regra.proprio ?? (ehPasta ? regra.proprioSePasta ?? null : null);
    const casou =
      (proprio !== null && proprio.test(relativo)) || regra.dentro.test(relativo);
    if (casou) decisao = !regra.negada;
  }
  return decisao;
}

// ---------------------------------------------------------------------------
// O que é suportado, e o que não é
// ---------------------------------------------------------------------------
//
// As três lacunas que este rodapé listava como recusadas — classes de
// caractere, `.gitignore` global e o índice do git — **foram fechadas** no
// T042 (spec 073). As classes estão aqui; as outras duas moram em
// `server/git-repo.ts`, porque dependem de disco e de caminho da máquina.
//
// O que continua de fora, e por quê:
//
// - **`\` escapando um caractere especial** (`\#arquivo`, `\!nome`). Aparece
//   em `.gitignore` gerado por ferramenta, quase nunca escrito à mão, e a
//   consequência de errar é pequena: um arquivo a mais ou a menos na varredura,
//   nunca perda de dado.
// - **`[[:alpha:]]` e as demais classes POSIX nomeadas.** O git as aceita
//   dentro de `[...]`; não vi nenhuma em `.gitignore` de projeto real.
