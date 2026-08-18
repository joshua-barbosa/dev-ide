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
  '.c': 'c', '.h': 'c',
  '.cs': 'csharp',
  '.json': 'json',
  '.html': 'html', '.htm': 'html',
  '.css': 'css',
  '.sql': 'sql',
};
