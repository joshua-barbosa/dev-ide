// Mapa de ícones.
//
// Fica em `shared` porque é a fonte da verdade de dois lados: o contrato do
// servidor (`NodeIcon` em connections/types.ts) e a interface, que desenha. O
// script de build também lê daqui a lista do pacote offline.
//
// A totalidade do mapa é responsabilidade do compilador: `Record<Icone, string>`
// não compila se um nome ficar sem correspondente. O que precisa de teste é o
// caminho de fuga — nome que o servidor manda e esta versão não conhece.

import { ICONES_DE_ARQUIVO } from './editor/arquivos';
import { ICONES_DE_LINGUAGEM } from './editor/idiomas';

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
/**
 * Ícones de marca dos serviços, declarados pelos drivers.
 *
 * Ficam aqui, e não no driver, porque o pacote offline é montado a partir desta
 * lista — um ícone declarado só no servidor não seria empacotado e cairia no
 * genérico em tempo de execução, silenciosamente.
 *
 * Conjunto `devicon`: tem marca própria para todos os bancos do roadmap,
 * inclusive SQL Server, e mantém as cores da marca em fundo escuro.
 */
export const ICONES_DE_SERVICO = {
  mysql: 'devicon:mysql',
  mariadb: 'devicon:mariadb',
  postgres: 'devicon:postgresql',
  sqlite: 'devicon:sqlite',
  sqlserver: 'devicon:microsoftsqlserver',
  mongodb: 'devicon:mongodb',
  redis: 'devicon:redis',
} as const;

const ICONES_DA_INTERFACE = [
  'lucide:circle-dot',
  'lucide:files',
  'lucide:boxes',
  'lucide:layers',
  'lucide:chevron-left',
  // `list-collapse`, e não `chevrons-down-up`: os dois chevrons convergindo
  // desenham um X em 14px, e X ao lado de outros botões lê como "fechar".
  'lucide:list-collapse',
  'lucide:pencil',
  'lucide:square-terminal',
  'lucide:list-filter',
  'lucide:chevron-right',
  'lucide:chevron-down',
  'lucide:lock',
  'lucide:unlock',
  'lucide:plus',
  'lucide:refresh-cw',
  'lucide:copy',
  'lucide:trash-2',
  'lucide:play',
  'lucide:save',
  'lucide:x',
  // A aba de tabela (spec 041): abrir a tabela, e exportar a página em dois
  // formatos. `braces` são as chaves do JSON; `file-down` é a seta de baixar.
  'lucide:table-2',
  'lucide:file-down',
  'lucide:braces',
  // `Abrir Query` num database (spec 038). Ficou de fora na entrega e saía como
  // bolinha — o guard de ícones só olhava literal entre aspas simples, e JSX usa
  // aspas duplas.
  'lucide:file-plus-2',
  // Navegador de pastas (spec 012): confirmar a pasta atual e subir um nível.
  'lucide:check',
  'lucide:corner-left-up',
  // Ocultar lateral e painel inferior (spec 014).
  'lucide:panel-left',
  'lucide:panel-bottom',
  // Dividir terminal e os panes na lista lateral (spec 021).
  'lucide:columns-2',
  'lucide:corner-down-right',
  // Botão de preview do markdown (spec 024).
  'lucide:book-open',
  'lucide:file-code',
  // Ações do cabeçalho da árvore (spec 035), na ordem do VS Code.
  'lucide:file-plus',
  'lucide:folder-plus',
  'lucide:refresh-cw',
  // `list-collapse`, e não `chevrons-down-up`: os dois chevrons convergindo
  // desenham um X em 14px, e X ao lado de outros botões lê como "fechar".
  'lucide:list-collapse',
  // Painel de busca (spec 027).
  'lucide:search',
  'lucide:replace',
  'lucide:replace-all',
] as const;

/**
 * Tudo que o pacote offline precisa conter. Ícone usado e ausente desta lista
 * some da tela sem erro nenhum — por isso há teste amarrando as duas coisas.
 */
export const ICONES_USADOS: readonly string[] = [
  ...new Set<string>([
    ...Object.values(MAPA),
    ...ICONES_DA_INTERFACE,
    ...ICONES_DE_LINGUAGEM,
    ...ICONES_DE_ARQUIVO,
    ...Object.values(ICONES_DE_SERVICO),
    ICONE_GENERICO,
  ]),
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
