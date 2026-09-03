// O que o "Abrir com…" pediu, lido da URL (03/09/2026).
//
// O processo do Electron recebe o caminho no `argv` e o repassa aqui pela URL —
// é o único canal que já existe entre os dois e que sobrevive ao recarregar a
// página.
//
// **Só é lido UMA VEZ.** Sem isso, todo `F5` reabriria a pasta que veio no
// primeiro lançamento, desfazendo qualquer troca de projeto que ele tivesse
// feito depois — um defeito que só apareceria depois de meia hora de uso.

export interface PedidoDeAbertura {
  readonly pasta: string;
  readonly arquivo?: string;
}

/** Lê o pedido da busca da URL. `null` quando não veio nenhum. */
export function pedidoDaUrl(busca: string): PedidoDeAbertura | null {
  const p = new URLSearchParams(busca);
  const pasta = p.get('abrirPasta');
  if (pasta === null || pasta === '') return null;
  const arquivo = p.get('abrirArquivo');
  return arquivo === null || arquivo === '' ? { pasta } : { pasta, arquivo };
}

/**
 * Apaga o pedido da barra de endereços, sem recarregar.
 *
 * `replaceState` e não `pushState`: um pedido de abertura não é um lugar para
 * onde voltar, e empilhá-lo faria o "voltar" do navegador reabrir a pasta.
 */
export function esquecerPedido(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('abrirPasta');
  url.searchParams.delete('abrirArquivo');
  window.history.replaceState(null, '', url.toString());
}
