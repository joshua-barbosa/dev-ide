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
// O que NÃO é suportado, e por quê
// ---------------------------------------------------------------------------
//
// - **Classes de caractere** (`[abc]`, `[a-z]`): raríssimas em `.gitignore` de
//   projeto, e o custo de acertar os casos de borda não se paga.
// - **`.gitignore` global do usuário** e `.git/info/exclude`: são configuração
//   da máquina, não do projeto, e a IDE não deve depender delas para decidir o
//   que varrer.
// - **Arquivo já rastreado pelo git** continua ignorado aqui. O git sabe o que
//   está no índice; nós não lemos o índice, e ler seria trazer um segundo
//   modelo de estado.
