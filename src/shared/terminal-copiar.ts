// Copiar e colar no terminal (03/09/2026).
//
// Relato dele: *"não estou conseguindo copiar texto do terminal e uso bastante"*.
//
// **Por que não funcionava.** O emulador desenha o texto ele mesmo, e a seleção
// que se faz com o mouse **não é uma seleção do DOM** — então o `Ctrl+C` do
// navegador não tem o que copiar. E o `Ctrl+C` do terminal significa outra
// coisa: é o `SIGINT`, o jeito de interromper um programa. Ligá-lo à cópia
// tiraria do terminal a tecla mais importante que ele tem.
//
// A saída é a mesma do VS Code e a que qualquer terminal de Linux usa há
// décadas: **`Ctrl+Shift+C` copia, `Ctrl+Shift+V` cola**, e o `Ctrl+C` continua
// interrompendo. Mais o menu de botão direito, que é o que se acha sem saber o
// atalho.

export type AcaoDoTerminal = 'copiar' | 'colar' | 'para-o-shell';

export interface TeclaDoTerminal {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * O que a tecla faz aqui dentro.
 *
 * **`Ctrl+C` vai SEMPRE para o shell**, com ou sem seleção. Copiar quando há
 * texto selecionado é o costume do Windows, e num terminal de Linux ele morde:
 * quem selecionou a saída de um programa para ler e depois precisa interrompê-lo
 * apertaria `Ctrl+C` e o programa continuaria rodando — sem nada na tela
 * explicando por quê.
 */
export function acaoDoTerminal(e: TeclaDoTerminal): AcaoDoTerminal {
  const controle = e.ctrlKey || e.metaKey;
  if (!controle || e.altKey || !e.shiftKey) return 'para-o-shell';

  const tecla = e.key.toLowerCase();
  if (tecla === 'c') return 'copiar';
  if (tecla === 'v') return 'colar';
  return 'para-o-shell';
}

/**
 * O texto pronto para a área de transferência.
 *
 * O emulador devolve a seleção com o **espaço de preenchimento até o fim da
 * linha**, porque cada linha tem a largura da janela. Colar isso num editor traz
 * dezenas de espaços invisíveis por linha — e é a diferença entre uma cópia útil
 * e uma que dá trabalho para limpar.
 *
 * `null` quando não há nada selecionado: quem chama não deve mexer na área de
 * transferência nesse caso, ou apagaria o que já estava lá.
 */
export function textoParaCopiar(selecao: string): string | null {
  if (selecao === '') return null;
  const limpo = selecao
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
  return limpo.trim() === '' ? null : limpo;
}
