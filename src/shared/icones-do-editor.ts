// Os ícones da árvore traduzidos para os do EDITOR.
//
// O pedido dele (08/09/2026): *"os ícones poderiam seguir os ícones do tema
// setado no cursor ou vscode"*. Dentro da webview isso é impossível — um SVG
// nosso não sabe qual tema ele escolheu, e essa informação só o editor tem.
// Com a árvore nativa ela vem de graça: `ThemeIcon` é desenhado pelo tema, e
// muda de cor junto com ele.
//
// Este arquivo é PURO de propósito, do lado do mapa que já existe para o
// lucide (`icons.ts`). É o único jeito de um teste garantir que nó novo de
// driver não caia num ícone genérico calado — que é exatamente o defeito que
// nenhuma suíte pega olhando a árvore de fora.
//
// **Sem `import` nenhum, de propósito.** A extensão compila com `rootDir: src`
// (o dela) e não alcança este arquivo — então ele é COPIADO para lá, e uma
// cópia só é confiável se for idêntica. Um `import` obrigaria a copiar a
// cadeia inteira. A completude continua garantida: o teste importa este mapa
// E o contrato, e exige que cubram os mesmos nomes.

/** Desenhado quando o nome não é reconhecido. Nunca um espaço vazio. */
export const CODICON_GENERICO = 'circle-outline';

/**
 * As marcas para as quais temos SVG colorido empacotado.
 *
 * Escolha DELE, em 08/09/2026: *"Os que não tiver usa o ícone padrão de
 * server"*. Marca é colorida e igual em qualquer tema — trocá-la por um
 * codicon monocromático faria três conexões diferentes ficarem idênticas na
 * lateral, que é justamente onde ele bate o olho para achar uma.
 */
export const MARCAS_COM_SVG: readonly string[] = [
  'mysql', 'mariadb', 'postgresql', 'sqlite', 'microsoftsqlserver', 'mongodb', 'redis',
];

/** Marca de produto, que o editor não tem — vem do nosso pacote. */
export function ehMarca(icone: string): boolean {
  return icone.startsWith('devicon:');
}

/**
 * O nome do SVG de marca a usar, ou `null` quando não temos um.
 *
 * Existe separado do `codiconDe` porque as duas coisas NÃO são o mesmo tipo:
 * um codicon é um nome que o editor desenha, um SVG é um arquivo do nosso
 * pacote. Devolver os dois pela mesma função faria o chamador tratar `redis`
 * como codicon — e codicon `redis` não existe, então o item sairia sem ícone
 * nenhum, calado.
 */
export function svgDaMarca(icone: string): string | null {
  if (!ehMarca(icone)) return null;
  const marca = icone.slice('devicon:'.length);
  return MARCAS_COM_SVG.includes(marca) ? marca : null;
}

const MAPA: Readonly<Record<string, string>> = {
  // árvore
  server: 'server',
  database: 'database',
  schema: 'symbol-namespace',
  table: 'table',
  view: 'eye',
  column: 'symbol-field',
  function: 'symbol-method',
  procedure: 'gear',
  index: 'key',
  // A materializada NÃO é o olho da view, pela mesma razão do mapa do lucide:
  // ela ocupa disco e precisa de REFRESH.
  matview: 'layers',
  sequence: 'list-ordered',
  type: 'symbol-class',
  foreign: 'link-external',
  event: 'calendar',
  security: 'shield',
  user: 'account',
  role: 'organization',
  trigger: 'zap',
  check: 'check',
  diagrama: 'type-hierarchy',
  collection: 'package',
  key: 'key',
  star: 'star-full',
  folder: 'folder',
  file: 'file',
  link: 'link',
  query: 'file-code',
  // Ícones que só os DRIVERS declaram — não são nós nem abas, mas chegam aqui
  // pelo `GET /api/connections/drivers` e desenham a linha da conexão.
  'server-cog': 'server-process',
  'folder-symlink': 'file-symlink-directory',
  // abas
  editor: 'file',
  sql: 'file-code',
  grid: 'table',
  connection: 'plug',
  terminal: 'terminal',
  sftp: 'folder',
  monitor: 'pulse',
};

/**
 * O codicon de um nome do contrato.
 *
 * Aceita as duas formas que o motor usa — `table` e `lucide:table` —, porque a
 * árvore recebe as duas: o driver declara a curta, e alguns nós nossos já
 * nascem qualificados.
 */
export function codiconDe(icone: string): string {
  // Marca sempre cai em `server` aqui — foi a escolha dele para o que o editor
  // não tem. Quem quiser o SVG colorido pergunta ao `svgDaMarca` ANTES.
  if (ehMarca(icone)) return 'server';
  const nome = icone.replace(/^lucide:/, '');
  return MAPA[nome] ?? CODICON_GENERICO;
}
