// Arquivo grande no editor: abrir com menos recursos, em vez de recusar.
//
// O limite era 2 MB e a resposta era um erro — *"Arquivo muito grande para
// abrir no editor"*. Isso não protegia ninguém: quem precisava olhar um dump,
// um log ou um `.sql` de carga ficava sem editor e sem alternativa, e o número
// 2 MB não vinha de medida nenhuma.
//
// A troca aqui é outra: **o teto de recusa sobe muito, e o que cai é o que
// custa caro.** Minimapa, dobra de código e realce de ocorrências percorrem o
// texto inteiro a cada tecla; num arquivo de 20 MB é isso que trava, e não o
// texto em si. Desligados, o Monaco rola um arquivo grande sem drama.

/** Acima disto, o editor abre em modo econômico. */
export const LIMIAR_DE_ARQUIVO_GRANDE = 2 * 1024 * 1024;

/**
 * Acima disto, o editor recusa — e diz por quê.
 *
 * O teto existe porque o conteúdo trafega como JSON e vive inteiro na memória
 * da aba: não é o Monaco que quebra primeiro, é o navegador. 32 MB é grande o
 * bastante para os dumps e logs que aparecem no dia a dia, e pequeno o bastante
 * para não derrubar a IDE inteira por causa de uma aba.
 */
export const MAX_BYTES_NO_EDITOR = 32 * 1024 * 1024;

export function ehArquivoGrande(bytes: number): boolean {
  return bytes > LIMIAR_DE_ARQUIVO_GRANDE;
}

/**
 * As opções do Monaco que dependem do tamanho.
 *
 * Tipo estrutural de propósito: o `monaco.editor` não entra em `shared/`, e
 * assim isto se testa sem navegador nenhum (Artigo III).
 */
export interface OpcoesPorTamanho {
  readonly minimap: { readonly enabled: boolean };
  readonly folding: boolean;
  readonly wordBasedSuggestions: 'currentDocument' | 'off';
  readonly occurrencesHighlight: 'singleFile' | 'off';
  readonly renderWhitespace: 'selection' | 'none';
  readonly wordWrap: 'on' | 'off';
}

export function opcoesParaTamanho(bytes: number, quebrarLinha = true): OpcoesPorTamanho {
  if (!ehArquivoGrande(bytes)) {
    return {
      minimap: { enabled: true },
      folding: true,
      wordBasedSuggestions: 'currentDocument',
      occurrencesHighlight: 'singleFile',
      renderWhitespace: 'selection',
      wordWrap: quebrarLinha ? 'on' : 'off',
    };
  }
  return {
    minimap: { enabled: false },
    folding: false,
    wordBasedSuggestions: 'off',
    occurrencesHighlight: 'off',
    renderWhitespace: 'none',
    // Um dump costuma ter linhas de milhões de colunas, e recalcular a quebra
    // delas é o pior caso do Monaco. Rolar na horizontal é o mal menor.
    wordWrap: 'off',
  };
}

/** A recusa, com o tamanho e uma saída — um beco sem saída não ajuda ninguém. */
export function mensagemDeArquivoEnorme(bytes: number): string {
  const mb = Math.round(bytes / 1024 / 1024);
  const teto = MAX_BYTES_NO_EDITOR / 1024 / 1024;
  return (
    `Este arquivo tem ${mb} MB e o editor abre até ${teto} MB. ` +
    'Use o terminal para inspecioná-lo — `head`, `tail` e `less` não carregam ' +
    'o arquivo inteiro na memória.'
  );
}
