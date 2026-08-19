// Markdown para HTML, com as regras de segurança em lugar visível.
//
// **Isto existe porque o `marked` cru não é seguro para conteúdo arbitrário**, e
// não esconde isso: por padrão ele repassa HTML bruto do documento e aceita
// `javascript:` em link. Conferido antes de escrever uma linha —
// `<script>alert(1)</script>` sai intacto, e `[x](javascript:alert(1))` vira um
// `<a href="javascript:...">`.
//
// A saída é injetada com `dangerouslySetInnerHTML`, então as duas defesas
// abaixo são o que separa "ver o README" de "executar o README". Elas moram
// aqui, em `shared`, para serem **testadas com as cargas reais** em vez de
// confiadas — o que é melhor que instalar um sanitizador e torcer.
//
// Por que não um sanitizador de prateleira: ele resolveria o mesmo problema com
// uma dependência a mais e sem teste nosso. Aqui as duas regras cabem em vinte
// linhas e ficam sob o mesmo portão de qualidade do resto.
import { marked, Renderer, type Tokens } from 'marked';

/**
 * Esquemas de URL que podem virar `href` ou `src`.
 *
 * `http`/`https` porque um README sem os selos de status fica pela metade, e
 * `mailto` porque é inofensivo. Tudo mais — `javascript:`, `data:`, `vbscript:`
 * e o que vier — é recusado.
 */
const ESQUEMAS_SEGUROS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** Controle e espaço: o truque clássico para burlar teste de prefixo. */
const CONTROLE = /[\u0000-\u0020\u007f-\u009f]/g;

/**
 * Devolve a URL se ela for segura, ou `null`.
 *
 * URL relativa passa: ela não pode carregar esquema nenhum, e é o que os links
 * internos de um README usam.
 */
export function urlSegura(bruto: string): string | null {
  const limpo = bruto.trim();
  if (limpo === '') return null;
  // `java\tscript:` passa por um `startsWith` ingênuo, e o navegador o resolve
  // como `javascript:`. Tirar o controle ANTES de olhar o esquema fecha isso.
  const semControle = limpo.replace(CONTROLE, '');
  if (semControle === '') return null;

  // Sem esquema é relativo — e relativo não executa nada.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(semControle)) return semControle;

  const esquema = semControle.slice(0, semControle.indexOf(':') + 1).toLowerCase();
  return ESQUEMAS_SEGUROS.has(esquema) ? semControle : null;
}

/** Escapa o que vira texto dentro do HTML gerado. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function criarRenderer(): Renderer {
  const r = new Renderer();

  // HTML bruto do documento vira TEXTO VISÍVEL, não marcação. É a defesa que
  // mata `<script>`, `<iframe>` e `<img onerror=…>` de uma vez — inclusive os
  // que ainda não foram inventados, porque nada de dentro do arquivo chega ao
  // DOM como elemento.
  r.html = ({ text }: Tokens.HTML | Tokens.Tag): string => escaparHtml(text);

  r.link = ({ href, title, tokens }: Tokens.Link): string => {
    const texto = r.parser.parseInline(tokens);
    const seguro = urlSegura(href);
    // Link recusado não some: vira o texto dele. Sumir esconderia do usuário
    // que havia algo ali.
    if (seguro === null) return texto;
    const t = title === null || title === undefined ? '' : ` title="${escaparHtml(title)}"`;
    // `target` e `rel` juntos: abrir fora e sem dar acesso ao `window.opener`.
    return `<a href="${escaparHtml(seguro)}"${t} target="_blank" rel="noreferrer noopener">${texto}</a>`;
  };

  r.image = ({ href, title, text }: Tokens.Image): string => {
    const seguro = urlSegura(href);
    if (seguro === null) return escaparHtml(text);
    const t = title === null || title === undefined ? '' : ` title="${escaparHtml(title)}"`;
    return `<img src="${escaparHtml(seguro)}" alt="${escaparHtml(text)}"${t}>`;
  };

  return r;
}

/**
 * Converte markdown em HTML já endurecido.
 *
 * `gfm` liga tabela, lista de tarefa e quebra de linha — é o dialeto que se
 * escreve na prática, e o README deste projeto usa tabela em quase toda seção.
 */
export function renderizarMarkdown(fonte: string): string {
  return marked.parse(fonte, {
    async: false,
    gfm: true,
    breaks: false,
    renderer: criarRenderer(),
  });
}

/** Linguagens cujo conteúdo faz sentido pré-visualizar. */
export function temPreview(linguagem: string): boolean {
  return linguagem === 'markdown';
}
