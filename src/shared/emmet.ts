// Configuração do Emmet (T022, T041).
//
// A desculpa que eu escrevi na spec 022 era que o Emmet "já vem configurado".
// Vem — com os padrões de quem o escreveu, não com os dele.
//
// Duas coisas se configuram, e as duas são o que a biblioteca alcança:
//
// - **snippets próprios**: abreviação dele virando expansão dele;
// - **onde o Emmet age**: a lista de linguagens de cada dialeto.
//
// O que NÃO se configura está declarado no fim deste arquivo, com o motivo.

/** Os três dialetos que a IDE liga — é o que `emmet-monaco-es` oferece. */
export type DialetoDoEmmet = 'html' | 'css' | 'jsx';

export const DIALETOS: readonly DialetoDoEmmet[] = ['html', 'css', 'jsx'];

/**
 * Onde cada dialeto age, por padrão.
 *
 * São ids de linguagem do MONACO, e não os nossos: é o que a biblioteca casa.
 * `php` está em `html` desde a spec 033 — e é por ele que Blade funciona, já
 * que um `.blade.php` abre como PHP (T041).
 */
export const LINGUAGENS_PADRAO: Readonly<Record<DialetoDoEmmet, readonly string[]>> = {
  html: ['html', 'php'],
  css: ['css'],
  jsx: ['javascript', 'typescript'],
};

export interface ConfiguracaoDoEmmet {
  /** Linguagens do Monaco em que cada dialeto age. */
  readonly linguagens: Readonly<Record<DialetoDoEmmet, readonly string[]>>;
  /** Abreviação → expansão, por dialeto. Vazio quando ele não declarou nenhum. */
  readonly snippets: Readonly<Record<DialetoDoEmmet, Readonly<Record<string, string>>>>;
}

export const EMMET_PADRAO: ConfiguracaoDoEmmet = {
  linguagens: LINGUAGENS_PADRAO,
  snippets: { html: {}, css: {}, jsx: {} },
};

function textos(bruto: unknown): readonly string[] | null {
  if (!Array.isArray(bruto)) return null;
  const lista = bruto.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return lista.map((v) => v.trim());
}

function mapaDeTextos(bruto: unknown): Readonly<Record<string, string>> {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    // Abreviação com espaço nunca dispararia — ela é a palavra que se digita,
    // e ela termina no espaço. Mesma regra dos snippets da spec 019.
    if (chave.trim() === '' || /\s/.test(chave.trim())) continue;
    if (typeof valor !== 'string' || valor.trim() === '') continue;
    saida[chave.trim()] = valor;
  }
  return saida;
}

/**
 * Lê a seção `emmet` do `config.json`, tolerando qualquer estrago.
 *
 * **Lista de linguagens VAZIA desliga o dialeto**, e é de propósito: é como se
 * desliga o Emmet no CSS sem inventar um interruptor separado. Já `ausente` é
 * outra coisa — cai no padrão, que é o que quem nunca mexeu espera.
 */
export function lerConfiguracaoDoEmmet(bruto: unknown): ConfiguracaoDoEmmet {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return EMMET_PADRAO;
  const raiz = bruto as Record<string, unknown>;

  const brutasLinguagens = (raiz.linguagens ?? {}) as Record<string, unknown>;
  const brutosSnippets = (raiz.snippets ?? {}) as Record<string, unknown>;

  const linguagens = {} as Record<DialetoDoEmmet, readonly string[]>;
  const snippets = {} as Record<DialetoDoEmmet, Readonly<Record<string, string>>>;
  for (const dialeto of DIALETOS) {
    linguagens[dialeto] = textos(brutasLinguagens[dialeto]) ?? LINGUAGENS_PADRAO[dialeto];
    snippets[dialeto] = mapaDeTextos(brutosSnippets[dialeto]);
  }
  return { linguagens, snippets };
}

/**
 * O nome do dialeto para a biblioteca de snippets do Emmet.
 *
 * Ela conhece `html` e `css`; JSX usa os snippets de HTML, porque é HTML com
 * outra sintaxe de atributo.
 */
export function sintaxeDoDialeto(dialeto: DialetoDoEmmet): string {
  return dialeto === 'css' ? 'css' : 'html';
}

// ---------------------------------------------------------------------------
// O que NÃO se configura, e por quê
// ---------------------------------------------------------------------------
//
// **Perfis de sintaxe** (`syntaxProfiles`: aspas simples, tag vazia com `/>`,
// indentação). O Emmet os suporta, mas `emmet-monaco-es` — a biblioteca que a
// IDE usa — não expõe caminho para eles: `emmetHTML` aceita só o tokenizador, e
// o `VSCodeEmmetConfig` que os leria fica dentro do módulo, sem porta.
//
// Alcançá-los exigiria substituir a biblioteca por uma integração própria com o
// `emmet` cru — e aí a IDE passaria a manter o "quando expandir" que hoje vem de
// graça, que é a parte difícil (ver a nota em `EditorHost`). É trabalho grande
// por um ganho de aspas simples, e por isso está declarado aqui em vez de feito
// pela metade.
