// Nossos nomes de linguagem traduzidos para os do Monaco.
//
// Existem dois vocabulários e eles não coincidem: a IDE chama de `plain` o que o
// Monaco chama de `plaintext`, e de `csharp` o que ele também chama `csharp` —
// mas `shell` ali é `shell`, e `dockerfile` é `dockerfile`. Escrever o mapa é
// mais honesto que torcer para os nomes baterem.
//
// Mora em `shared` porque é dado puro e testável, e porque o `EXT_TO_LANG` que
// alimenta este mapa também vive aqui.

/** Nossos nomes → nomes do Monaco. Ausente cai em texto puro. */
const PARA_MONACO: Readonly<Record<string, string>> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  php: 'php',
  c: 'c',
  csharp: 'csharp',
  sql: 'sql',
  json: 'json',
  html: 'html',
  css: 'css',
  plain: 'plaintext',
  // Acrescentadas na spec 010, a pedido do usuário. O markdown foi o que
  // decidiu: todas as specs do projeto são `.md` e abriam como texto puro.
  yaml: 'yaml',
  markdown: 'markdown',
  shell: 'shell',
  xml: 'xml',
  dockerfile: 'dockerfile',
  // T041. Nenhum dos dois tem modo próprio no Monaco, e escrever dois
  // tokenizadores para ganhar cor em `@if` e `{% %}` seria caro; o que eles são
  // de fato — HTML com marcação extra — o Monaco já sabe pintar.
  //
  // **É esta linha que liga o Emmet neles**: a biblioteca casa por id do
  // MONACO, e `html` e `php` já estão na lista de dialetos.
  twig: 'html',
  blade: 'php',
};

export const LINGUAGEM_PADRAO_MONACO = 'plaintext';

export function idDoMonaco(nossa: string): string {
  return PARA_MONACO[nossa] ?? LINGUAGEM_PADRAO_MONACO;
}

/** As linguagens que o build precisa incluir. Menos que as ~80 do pacote. */
export const LINGUAGENS_DO_MONACO: readonly string[] = [
  ...new Set(Object.values(PARA_MONACO)),
];
