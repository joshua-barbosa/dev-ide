// Catálogo de linguagens do editor: valor, rótulo e ícone.
//
// Saiu da barra de ferramentas quando ela foi removida. É dado puro, e mora aqui
// porque três lugares consultam: a lista do seletor, o rótulo da barra de status
// e o pacote de ícones — que é gerado a partir desta declaração, e por isso não
// tem como divergir dela.
export const LINGUAGENS: ReadonlyArray<readonly [valor: string, rotulo: string, icone: string]> = [
  ['javascript', 'JavaScript', 'vscode-icons:file-type-js-official'],
  ['typescript', 'TypeScript', 'vscode-icons:file-type-typescript-official'],
  ['python', 'Python', 'vscode-icons:file-type-python'],
  ['php', 'PHP', 'vscode-icons:file-type-php'],
  // T041: têm rótulo e ícone próprios, e realce emprestado — ver `monaco-ids`.
  ['blade', 'Blade', 'vscode-icons:file-type-php'],
  ['twig', 'Twig', 'vscode-icons:file-type-html'],
  ['c', 'C', 'vscode-icons:file-type-c'],
  ['csharp', 'C#', 'vscode-icons:file-type-csharp'],
  ['sql', 'SQL', 'vscode-icons:file-type-sql'],
  ['json', 'JSON', 'vscode-icons:file-type-json'],
  ['html', 'HTML', 'vscode-icons:file-type-html'],
  ['css', 'CSS', 'vscode-icons:file-type-css'],
  // Mesma correção da spec 024: estas existiam no mapa do Monaco e não aqui,
  // então não apareciam no seletor do rodapé.
  ['markdown', 'Markdown', 'vscode-icons:file-type-markdown'],
  ['yaml', 'YAML', 'vscode-icons:file-type-yaml'],
  ['shell', 'Shell', 'vscode-icons:file-type-shell'],
  ['xml', 'XML', 'vscode-icons:file-type-xml'],
  ['dockerfile', 'Dockerfile', 'vscode-icons:file-type-docker'],
  ['plain', 'Texto', 'vscode-icons:file-type-text'],
];

/** Ícones das linguagens, para o pacote offline empacotar. */
export const ICONES_DE_LINGUAGEM: readonly string[] = LINGUAGENS.map(([, , icone]) => icone);

export function rotuloDaLinguagem(valor: string): string {
  return LINGUAGENS.find(([v]) => v === valor)?.[1] ?? valor;
}

export function iconeDaLinguagem(valor: string): string {
  return LINGUAGENS.find(([v]) => v === valor)?.[2] ?? 'vscode-icons:file-type-text';
}
