// Mapa de ícones.
//
// Fica em `shared` porque é a fonte da verdade de dois lados: o contrato do
// servidor (`NodeIcon` em connections/types.ts) e a interface, que desenha. O
// script de build também lê daqui a lista do pacote offline.
//
// A totalidade do mapa é responsabilidade do compilador: `Record<Icone, string>`
// não compila se um nome ficar sem correspondente. O que precisa de teste é o
// caminho de fuga — nome que o servidor manda e esta versão não conhece.

/** Ícones que um nó da árvore pode pedir. `NodeIcon` do contrato deriva daqui. */
export const NODE_ICONS = [
  'server', 'database', 'schema', 'table', 'view', 'column',
  'function', 'procedure', 'index', 'collection', 'key',
  'folder', 'file', 'link', 'query',
] as const;

/** Ícones de aba, por tipo de conteúdo. */
export const TAB_ICONS = [
  'editor', 'sql', 'grid', 'connection', 'terminal', 'sftp', 'monitor',
] as const;

export type NodeIcon = (typeof NODE_ICONS)[number];
export type TabIcon = (typeof TAB_ICONS)[number];
export type Icone = NodeIcon | TabIcon;

/** Desenhado quando o nome não é reconhecido — nunca um espaço vazio. */
export const ICONE_GENERICO = 'lucide:circle';

const MAPA: Record<Icone, string> = {
  // árvore
  server: 'lucide:server',
  database: 'lucide:database',
  schema: 'lucide:library',
  table: 'lucide:table',
  view: 'lucide:eye',
  column: 'lucide:columns-3',
  function: 'lucide:square-function',
  procedure: 'lucide:cog',
  index: 'lucide:key-round',
  collection: 'lucide:package',
  key: 'lucide:key',
  folder: 'lucide:folder',
  file: 'lucide:file',
  link: 'lucide:link',
  query: 'lucide:file-code',
  // abas
  editor: 'lucide:file',
  sql: 'lucide:file-code',
  grid: 'lucide:table',
  connection: 'lucide:plug',
  terminal: 'lucide:terminal',
  sftp: 'lucide:folder',
  monitor: 'lucide:activity',
};

/** Ícones da própria interface, que não vêm de nenhum nó. */
const ICONES_DA_INTERFACE = [
  'lucide:chevron-right',
  'lucide:chevron-down',
  'lucide:lock',
  'lucide:unlock',
  'lucide:plus',
  'lucide:refresh-cw',
  'lucide:copy',
  'lucide:trash-2',
  'lucide:play',
  'lucide:x',
] as const;

/**
 * Tudo que o pacote offline precisa conter. Ícone usado e ausente desta lista
 * some da tela sem erro nenhum — por isso há teste amarrando as duas coisas.
 */
export const ICONES_USADOS: readonly string[] = [
  ...new Set<string>([...Object.values(MAPA), ...ICONES_DA_INTERFACE, ICONE_GENERICO]),
];

/**
 * Traduz o nome para o ícone do conjunto.
 *
 * Aceita duas formas: um nome do contrato (`database`) ou um já qualificado
 * (`lucide:x`), que é como a própria interface pede ícones que não vêm de
 * nenhum nó. Nos dois casos, o que não estiver empacotado cai no genérico —
 * um driver mais novo que a interface, ou um erro de digitação, não pode abrir
 * buraco na tela.
 */
export function resolverIcone(nome: string): string {
  if (nome.includes(':')) {
    return ICONES_USADOS.includes(nome) ? nome : ICONE_GENERICO;
  }
  return Object.prototype.hasOwnProperty.call(MAPA, nome)
    ? MAPA[nome as Icone]
    : ICONE_GENERICO;
}
