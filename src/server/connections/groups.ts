// Grupos aninhados de conexões.
//
// Um grupo NÃO é uma entidade persistida: ele é derivado do campo `group` de
// cada conexão, um caminho tipo "ACME/Bancos". Consequências úteis disso:
// renomear um grupo é reescrever um prefixo, e grupo vazio simplesmente não
// existe — não há como acumular pasta órfã no arquivo.
import type { PublicConnection } from './types';

const SEPARATOR = '/';

export interface GroupNode {
  /** Nome do próprio grupo ("Bancos"). Vazio na raiz. */
  readonly name: string;
  /** Caminho completo ("ACME/Bancos"). Vazio na raiz. */
  readonly path: string;
  readonly groups: readonly GroupNode[];
  readonly connections: readonly PublicConnection[];
}

/** Quebra o caminho em segmentos limpos, descartando vazios e espaços. */
function segments(raw: string): string[] {
  return raw
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Forma canônica de um caminho de grupo: "/ACME//Bancos/" -> "ACME/Bancos". */
export function normalizeGroupPath(raw: string): string {
  return segments(raw).join(SEPARATOR);
}

/**
 * Reescreve o caminho `group` quando o grupo `from` vira `to`.
 * Só casa em fronteira de segmento — "ACMEX" não é afetado por renomear "ACME".
 */
export function applyGroupRename(group: string, from: string, to: string): string {
  const atual = normalizeGroupPath(group);
  const origem = normalizeGroupPath(from);
  if (atual === origem) return normalizeGroupPath(to);
  if (!atual.startsWith(origem + SEPARATOR)) return atual;
  return normalizeGroupPath(to + atual.slice(origem.length));
}

/** Nó mutável usado só durante a construção; a saída é congelada em GroupNode. */
interface Builder {
  name: string;
  path: string;
  groups: Map<string, Builder>;
  connections: PublicConnection[];
}

function newBuilder(name: string, path: string): Builder {
  return { name, path, groups: new Map(), connections: [] };
}

function descend(root: Builder, path: readonly string[]): Builder {
  let node = root;
  for (const name of path) {
    let child = node.groups.get(name);
    if (child === undefined) {
      child = newBuilder(name, node.path === '' ? name : `${node.path}${SEPARATOR}${name}`);
      node.groups.set(name, child);
    }
    node = child;
  }
  return node;
}

/** Pastas antes de folhas, cada bloco alfabético — mesma regra de readTree() em projects.ts. */
function freeze(node: Builder): GroupNode {
  return {
    name: node.name,
    path: node.path,
    groups: [...node.groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(freeze),
    connections: [...node.connections].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Monta a árvore de grupos a partir da lista plana de conexões. */
export function buildGroupTree(connections: readonly PublicConnection[]): GroupNode {
  const root = newBuilder('', '');
  for (const connection of connections) {
    descend(root, segments(connection.group)).connections.push(connection);
  }
  return freeze(root);
}
