import * as fs from 'fs';
import * as path from 'path';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.runs']);
const PROJECT_NAME_RE = /^[a-zA-Z0-9_\-. ]{1,64}$/;

export class ProjectStore {
  constructor(private readonly baseDir: string) {}

  get root(): string {
    return this.baseDir;
  }

  ensureBaseDir(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  listProjects(): string[] {
    this.ensureBaseDir();
    return fs
      .readdirSync(this.baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  createProject(name: string): string {
    if (!PROJECT_NAME_RE.test(name)) {
      throw new Error(
        'Nome de projeto inválido. Use letras, números, espaços, "-", "_" ou "." (máx. 64 caracteres).'
      );
    }
    this.ensureBaseDir();
    const dir = path.join(this.baseDir, name);
    if (fs.existsSync(dir)) {
      throw new Error(`O projeto "${name}" já existe.`);
    }
    fs.mkdirSync(dir);
    return dir;
  }

  projectDir(name: string): string {
    const dir = path.resolve(this.baseDir, name);
    if (!dir.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new Error('Caminho de projeto inválido.');
    }
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new Error(`Projeto "${name}" não encontrado.`);
    }
    return dir;
  }

  fileTree(name: string): FileNode[] {
    return readTree(this.projectDir(name));
  }

  /** Lista recursivamente os caminhos absolutos dos arquivos do projeto. */
  projectFiles(name: string, extensions?: Set<string>): string[] {
    const result: string[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.type === 'dir') {
          walk(node.children ?? []);
        } else if (!extensions || extensions.has(path.extname(node.name))) {
          result.push(node.path);
        }
      }
    };
    walk(this.fileTree(name));
    return result;
  }
}

function readTree(dir: string): FileNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: full, type: 'dir', children: readTree(full) });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: full, type: 'file' });
    }
  }
  nodes.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
  );
  return nodes;
}
