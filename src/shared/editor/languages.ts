// Extensão de arquivo → linguagem da IDE.
//
// É o que sobrou de `languages.ts` depois da spec 010. A gramática e a lista de
// palavras reservadas foram embora com o tokenizador próprio: o Monaco faz
// análise de verdade, e manter duas definições da mesma linguagem seria pedir
// para elas divergirem.
//
// Este mapa fica porque tem dois consumidores que nada têm a ver com realce:
// `linguagemDe()`, que decide a linguagem ao abrir um arquivo, e o ícone por
// extensão da árvore e das abas.

export const EXT_TO_LANG: Record<string, string> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python',
  '.php': 'php',
  // T041. `.blade.php` cai em `.php` pela extensão — o nome inteiro é checado
  // ANTES, e é por isso que o Blade ganha rótulo e ícone próprios sem perder o
  // realce de PHP. Ver `NOME_TO_LANG` e `linguagemDe`.
  '.twig': 'twig',
  '.blade.php': 'blade',
  '.c': 'c', '.h': 'c',
  '.cs': 'csharp',
  '.json': 'json',
  '.html': 'html', '.htm': 'html',
  '.css': 'css',
  '.sql': 'sql',
  // Acrescentadas na spec 024. A spec 010 declarou estas linguagens em
  // `monaco-ids.ts` e parou aí — o mapa de extensões nunca foi atualizado, então
  // `.md` continuou abrindo como texto puro. O comentário de lá dizia que o
  // problema estava resolvido; não estava. O teste de cruzamento entre os três
  // mapas entrou junto, para a divergência não voltar em silêncio.
  '.md': 'markdown', '.markdown': 'markdown',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.xml': 'xml', '.svg': 'xml',
  '.dockerfile': 'dockerfile',
};

/** Arquivos sem extensão cujo NOME decide a linguagem. */
export const NOME_TO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'shell',
};
