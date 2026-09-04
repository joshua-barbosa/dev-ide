// Ícone por extensão de arquivo.
//
// Conjunto `vscode-icons`, que é o tema de ícones do próprio VS Code — feito
// para EXTENSÃO, e não para produto. É a divisão que interessa aqui:
//
// - `devicon` identifica um produto: a conexão é um MySQL, um PostgreSQL.
// - `vscode-icons` identifica um arquivo: `.md`, `.json`, `.env`, `.log` — que
//   não têm marca nenhuma e ficariam sem ícone num conjunto de tecnologias.
//
// Usar um só conjunto para os dois papéis deixaria metade dos casos sem ícone.
import { nomeParaExibir } from '../caminho-local';
import { iconeDaLinguagem } from './idiomas';

const POR_EXTENSAO: Readonly<Record<string, string>> = {
  '.md': 'vscode-icons:file-type-markdown',
  '.markdown': 'vscode-icons:file-type-markdown',
  '.yml': 'vscode-icons:file-type-yaml',
  '.yaml': 'vscode-icons:file-type-yaml',
  '.sh': 'vscode-icons:file-type-shell',
  '.bash': 'vscode-icons:file-type-shell',
  '.zsh': 'vscode-icons:file-type-shell',
  '.log': 'vscode-icons:file-type-log',
  '.txt': 'vscode-icons:file-type-text',
  '.env': 'vscode-icons:file-type-config',
  '.ini': 'vscode-icons:file-type-config',
  '.conf': 'vscode-icons:file-type-config',
  '.toml': 'vscode-icons:file-type-config',
  '.db': 'vscode-icons:file-type-db',
  '.sqlite': 'vscode-icons:file-type-db',
  '.sqlite3': 'vscode-icons:file-type-db',
  '.png': 'vscode-icons:file-type-image',
  '.jpg': 'vscode-icons:file-type-image',
  '.jpeg': 'vscode-icons:file-type-image',
  '.gif': 'vscode-icons:file-type-image',
  '.svg': 'vscode-icons:file-type-image',
  '.webp': 'vscode-icons:file-type-image',
  '.go': 'vscode-icons:file-type-go',
  '.rs': 'vscode-icons:file-type-rust',
  '.java': 'vscode-icons:file-type-java',
  '.rb': 'vscode-icons:file-type-ruby',
  '.vue': 'vscode-icons:file-type-vue',
  '.gitignore': 'vscode-icons:file-type-git',
  '.gitattributes': 'vscode-icons:file-type-git',
  '.gitmodules': 'vscode-icons:file-type-git',
  // Os "ignore" e "rc" que povoam a raiz de um projeto. Passaram a aparecer na
  // árvore na spec 029, e sem entrada aqui sairiam todos como papel em branco.
  '.dockerignore': 'vscode-icons:file-type-config',
  '.cursorignore': 'vscode-icons:file-type-config',
  '.npmrc': 'vscode-icons:file-type-config',
  '.nvmrc': 'vscode-icons:file-type-config',
  '.editorconfig': 'vscode-icons:file-type-config',
  '.prettierrc': 'vscode-icons:file-type-config',
  '.eslintrc': 'vscode-icons:file-type-config',
};

export const ICONE_DE_ARQUIVO = 'vscode-icons:default-file';
export const ICONE_DE_PASTA = 'vscode-icons:default-folder';
export const ICONE_DE_PASTA_ABERTA = 'vscode-icons:default-folder-opened';

/** Ícones desta tabela, para o pacote offline empacotar. */
export const ICONES_DE_ARQUIVO: readonly string[] = [
  ...new Set([
    ...Object.values(POR_EXTENSAO),
    ICONE_DE_ARQUIVO,
    ICONE_DE_PASTA,
    ICONE_DE_PASTA_ABERTA,
  ]),
];

/**
 * Ícone de um caminho.
 *
 * A tabela acima cobre o que não é linguagem; o resto cai no catálogo de
 * linguagens, que já mapeia `.ts`, `.py`, `.php` e companhia — assim uma
 * linguagem nova entra num lugar só.
 */
export function iconeDeArquivo(caminho: string, linguagem?: string): string {
  const nome = nomeParaExibir(caminho);
  const ext = nome.includes('.') ? `.${nome.split('.').pop()?.toLowerCase() ?? ''}` : nome;

  const direto = POR_EXTENSAO[ext] ?? POR_EXTENSAO[nome.toLowerCase()];
  if (direto !== undefined) return direto;

  // `.env.example`, `.env.local`, `.env.production`: a extensão de cada um é
  // diferente e todos são o mesmo tipo de arquivo. Regra de prefixo em vez de
  // uma linha na tabela para cada sufixo que alguém inventar.
  if (nome.toLowerCase().startsWith('.env')) return POR_EXTENSAO['.env'] ?? ICONE_DE_ARQUIVO;

  // `plain` significa "não reconheci", e aí o papel em branco é mais honesto
  // que o ícone de texto puro.
  if (linguagem !== undefined && linguagem !== 'plain') return iconeDaLinguagem(linguagem);
  return ICONE_DE_ARQUIVO;
}
