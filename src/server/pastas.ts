// Ler pastas do sistema de arquivos: navegador e árvore.
//
// **O teto desta árvore não é enfeite.** Enquanto a IDE só abria `projects/`,
// percorrer tudo recursivamente era seguro por acidente: as pastas eram
// pequenas. Com "abra qualquer pasta", apontar para `~` ou `/` percorreria o
// disco inteiro, de forma síncrona, no mesmo processo que serve a interface — a
// IDE congelaria sem nem dar erro.
//
// O corte é **incremental**: para de descer ao atingir o teto, em vez de ler
// tudo e cortar depois. É a mesma regra que o Artigo III impõe ao limite de
// linhas dos drivers.
import * as fs from 'fs';
import * as path from 'path';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

export interface ArvoreDaPasta {
  readonly nodes: readonly FileNode[];
  /** Verdadeiro quando o teto cortou. A interface avisa — ver AC-13. */
  readonly truncated: boolean;
}

export interface Subpasta {
  readonly name: string;
  readonly path: string;
}

export interface ListagemDePastas {
  readonly path: string;
  /** `null` na raiz do sistema de arquivos. */
  readonly parent: string | null;
  readonly dirs: readonly Subpasta[];
}

/**
 * O que a árvore não mostra.
 *
 * **Não é "oculto"**: é o que tem milhares de nós e ninguém edita. Gastariam o
 * teto de `MAX_NOS` antes de o código do projeto aparecer. Arquivo oculto de
 * verdade — `.gitignore`, `.env`, `.vscode/` — APARECE: dentro de um projeto,
 * oculto é arquivo que se edita, e escondê-lo foi um defeito reportado pelo
 * usuário em 2026-08-19.
 */
const IGNORADAS = new Set([
  // JavaScript
  'node_modules', 'dist', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
  // Python — `.venv` sozinha tem milhares de arquivos e comia o teto INTEIRO,
  // deixando a árvore com seis entradas. Foi o que apareceu ao mostrar ocultos.
  '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox',
  // PHP e Rust
  'vendor', 'target',
  // Controle de versão e a própria IDE
  '.git', '.hg', '.svn', '.runs',
]);
export const MAX_NOS = 5_000;
export const MAX_PROFUNDIDADE = 12;

/** Recusa o que não é pasta existente, com mensagem que diz o caminho. */
export function pastaValida(bruto: string): string {
  if (bruto.includes('\0')) throw new Error('Caminho inválido.');
  const alvo = path.resolve(bruto);
  if (!fs.existsSync(alvo) || !fs.statSync(alvo).isDirectory()) {
    throw new Error(`Pasta não encontrada: ${alvo}`);
  }
  return alvo;
}

/**
 * Subpastas de um diretório, para o navegador.
 *
 * Mostra as ocultas? Não: `.cache`, `.local` e companhia são ruído, e quem
 * precisa de uma sabe digitar o caminho. Já as ignoradas da árvore
 * (`node_modules`) APARECEM aqui — abrir `node_modules` de propósito é raro,
 * mas escondê-la seria mentir sobre o que existe no disco.
 */
export function listarSubpastas(alvo: string): ListagemDePastas {
  const dirs: Subpasta[] = [];
  for (const entrada of fs.readdirSync(alvo, { withFileTypes: true })) {
    if (entrada.name.startsWith('.')) continue;
    if (!entrada.isDirectory()) continue;
    dirs.push({ name: entrada.name, path: path.join(alvo, entrada.name) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const pai = path.dirname(alvo);
  return { path: alvo, parent: pai === alvo ? null : pai, dirs };
}

/** Árvore de arquivos da pasta, com teto de nós e de profundidade. */
export function arvoreDaPasta(alvo: string): ArvoreDaPasta {
  let restantes = MAX_NOS;

  const ler = (dir: string, profundidade: number): FileNode[] => {
    if (profundidade > MAX_PROFUNDIDADE) return [];
    let entradas: fs.Dirent[];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Pasta sem permissão de leitura: some da árvore em vez de derrubá-la.
      return [];
    }

    const nodes: FileNode[] = [];
    for (const entrada of entradas) {
      if (restantes <= 0) break;
      if (IGNORADAS.has(entrada.name)) continue;
      const full = path.join(dir, entrada.name);
      restantes -= 1;
      if (entrada.isDirectory()) {
        nodes.push({
          name: entrada.name, path: full, type: 'dir',
          children: ler(full, profundidade + 1),
        });
      } else if (entrada.isFile()) {
        nodes.push({ name: entrada.name, path: full, type: 'file' });
      }
    }
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
    );
    return nodes;
  };

  const nodes = ler(alvo, 0);
  return { nodes, truncated: restantes <= 0 };
}

/** Caminhos dos arquivos da árvore, opcionalmente filtrados por extensão. */
export function arquivosDaArvore(
  nodes: readonly FileNode[],
  extensoes?: ReadonlySet<string>
): string[] {
  const saida: string[] = [];
  const andar = (lista: readonly FileNode[]): void => {
    for (const no of lista) {
      if (no.type === 'dir') andar(no.children ?? []);
      else if (extensoes === undefined || extensoes.has(path.extname(no.name))) saida.push(no.path);
    }
  };
  andar(nodes);
  return saida;
}

/** Resolve um nome relativo dentro da pasta, recusando o que escapa dela. */
export function dentroDaPasta(pasta: string, relativo: string): string {
  if (relativo.includes('\0')) throw new Error('Caminho inválido.');
  const alvo = path.resolve(pasta, relativo);
  if (alvo !== pasta && !alvo.startsWith(pasta + path.sep)) {
    throw new Error('O arquivo precisa ficar dentro da pasta aberta.');
  }
  return alvo;
}
