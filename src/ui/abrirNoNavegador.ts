// Abrir um endereço no navegador do sistema — o login do OAuth 2.0 (spec 120,
// etapa 5).
//
// Na IDE é `window.open`. Na webview do editor, `window.open` não abre nada
// (e calado): quem abre é o editor (`vscode.env.openExternal`), pela ponte. A
// subida da webview troca a função, como `definirTransferencia` faz com os
// arquivos.
let abridor: (url: string) => Promise<void> = async (url) => {
  // `noopener`: a página do provedor não ganha `window.opener` para mexer na IDE.
  window.open(url, '_blank', 'noopener,noreferrer');
};

export function definirAbridor(novo: (url: string) => Promise<void>): void {
  abridor = novo;
}

/** Só http e https: um `javascript:` ou `file:` vindo de um campo não abre. */
export async function abrirNoNavegador(url: string): Promise<void> {
  const protocolo = new URL(url).protocol;
  if (protocolo !== 'http:' && protocolo !== 'https:') throw new Error(`Endereço não abre no navegador: ${protocolo}`);
  await abridor(url);
}
