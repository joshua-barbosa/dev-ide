// O caminho que veio pelo "Abrir com…" (pedido dele em 03/09/2026).
//
// **A metade que se esquece deste recurso é esta.** Pôr `MimeType=` no
// `.desktop` faz o Braytech Code aparecer no menu do gerenciador de arquivos —
// e clicar nele abriria uma janela VAZIA, porque o aplicativo ignorava o
// caminho que o sistema passa. O menu que aparece e não faz nada é pior que
// menu nenhum.
//
// Ler o argumento certo é chato o bastante para morar aqui, testado: o Electron
// mistura no `argv` o caminho do próprio binário, o do script em
// desenvolvimento, e um punhado de opções que começam com `-`.

/**
 * O caminho a abrir, ou `null`.
 *
 * `emDesenvolvimento` é `!app.isPackaged`: no modo empacotado o `argv[0]` é o
 * binário e o resto são argumentos de verdade; rodando pelo código, o `argv[1]`
 * é o script do processo principal e **não** é para abrir.
 */
export function caminhoParaAbrir(
  argv: readonly string[],
  emDesenvolvimento: boolean
): string | null {
  // Pula o binário, e também o script quando se está desenvolvendo.
  const candidatos = argv.slice(emDesenvolvimento ? 2 : 1);

  for (const bruto of candidatos) {
    // Opção do Chromium (`--no-sandbox`, `--inspect=…`) nunca é caminho.
    if (bruto.startsWith('-')) continue;
    // O gerenciador de arquivos pode entregar `file:///caminho`.
    const limpo = bruto.startsWith('file://') ? decodificarFileUrl(bruto) : bruto;
    if (limpo === '' || limpo === '.') continue;
    return limpo;
  }
  return null;
}

/**
 * `file:///home/ana/um%20arquivo.txt` → `/home/ana/um arquivo.txt`.
 *
 * Sem decodificar, todo arquivo com espaço ou acento — que é a maioria dos dele
 * — abriria como "não encontrado", e o caminho na mensagem de erro pareceria
 * certo à primeira vista.
 */
export function decodificarFileUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return '';
  }
}

/** O que fazer com o caminho recebido. */
export interface AberturaPedida {
  /** A pasta que vira a raiz da árvore. */
  readonly pasta: string;
  /** O arquivo a abrir no editor, quando veio um arquivo. */
  readonly arquivo?: string;
}

/**
 * Traduz o caminho recebido em "que pasta abrir, e que arquivo mostrar".
 *
 * Ele pediu que o "Abrir com…" valesse **para pasta também**, e as duas coisas
 * pedem tratamentos diferentes:
 *
 * - **Pasta** vira a raiz da árvore, e nenhum arquivo é aberto. É o "abrir
 *   projeto".
 * - **Arquivo** abre no editor, **e a pasta que o contém vira a raiz**. Abrir só
 *   o arquivo deixaria a árvore vazia ao lado dele — e quem clicou num `.ts` no
 *   gerenciador quase sempre quer mexer no projeto, não naquele arquivo sozinho.
 *
 * `ehPasta` vem de quem sabe olhar o disco; esta função não toca em `fs` para
 * continuar testável sem criar arquivo nenhum.
 */
export function aberturaPedida(caminho: string, ehPasta: boolean): AberturaPedida {
  if (ehPasta) return { pasta: semBarraFinal(caminho) };
  return { pasta: pastaDe(caminho), arquivo: caminho };
}

/** A pasta que contém o caminho. Raiz continua raiz. */
export function pastaDe(caminho: string): string {
  const corte = caminho.lastIndexOf('/');
  if (corte <= 0) return '/';
  return caminho.slice(0, corte);
}

/** `/casa/projeto/` → `/casa/projeto`. A barra final atrapalha a comparação. */
export function semBarraFinal(caminho: string): string {
  return caminho.length > 1 && caminho.endsWith('/') ? caminho.slice(0, -1) : caminho;
}
