// A conversa entre o motor e o kernel do notebook (spec 112, etapa 2).
//
// O kernel é um processo vivo, e fala com o motor pelo `stdout` — o MESMO canal
// onde cai o `print` do usuário. Um canal separado (um descritor 3) seria mais
// limpo, mas no Windows um processo que não é Node não herda descritor extra
// com garantia, e Windows é uso real aqui.
//
// Então cada mensagem do kernel começa por uma MARCA que texto comum não tem:
// dois caracteres de controle (separador de registro e de unidade, do ASCII)
// em volta de `BRNB`. O que vem antes da marca é `print`; da marca até o `\n`,
// uma mensagem em JSON.
//
// O canal chega picado em pedaços arbitrários — no meio da mensagem, no meio da
// própria marca. `separar` devolve o que já dá para entregar e guarda o resto.

export const MARCA = '\u001eBRNB\u001f';

/** Uma mensagem pronta para ir ao canal: marca + JSON numa linha só. */
export function mensagem(dados: unknown): string {
  // `JSON.stringify` escapa `\n` dentro de texto, então a linha é uma só.
  return `${MARCA}${JSON.stringify(dados)}\n`;
}

export type ItemDoCanal = { readonly texto: string } | { readonly mensagem: unknown };

/** Quantos caracteres do fim podem ser o COMEÇO de uma marca. */
function prefixoDaMarca(pedaco: string): number {
  for (let n = Math.min(MARCA.length - 1, pedaco.length); n > 0; n -= 1) {
    if (MARCA.startsWith(pedaco.slice(-n))) return n;
  }
  return 0;
}

export function separar(buffer: string): { readonly itens: ItemDoCanal[]; readonly resto: string } {
  const itens: ItemDoCanal[] = [];
  let resto = buffer;
  for (;;) {
    const onde = resto.indexOf(MARCA);
    if (onde === -1) {
      // Sem marca inteira: entrega o texto, menos a cauda que pode ser o começo de uma.
      const guarda = prefixoDaMarca(resto);
      const texto = resto.slice(0, resto.length - guarda);
      if (texto !== '') itens.push({ texto });
      return { itens, resto: resto.slice(resto.length - guarda) };
    }
    if (onde > 0) itens.push({ texto: resto.slice(0, onde) });
    const fimDaLinha = resto.indexOf('\n', onde);
    if (fimDaLinha === -1) return { itens, resto: resto.slice(onde) };
    const json = resto.slice(onde + MARCA.length, fimDaLinha);
    try {
      itens.push({ mensagem: JSON.parse(json) });
    } catch {
      // Marca seguida de lixo: vale como texto — é melhor mostrar que sumir.
      itens.push({ texto: resto.slice(onde, fimDaLinha + 1) });
    }
    resto = resto.slice(fimDaLinha + 1);
  }
}
