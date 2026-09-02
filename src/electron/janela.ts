// A janela do desktop: onde ela nasce e de que tamanho (T094).
//
// Separado do `main.ts` porque é a parte que dá para testar sem abrir janela
// nenhuma: qual porta usar, que tamanho lembrar, e o que fazer quando o que
// estava guardado não serve mais nesta tela.

export interface Retangulo {
  readonly x: number;
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
}

export const JANELA_PADRAO: Retangulo = { x: 0, y: 0, largura: 1440, altura: 900 };

/** O menor tamanho em que a IDE ainda é usável — abaixo disto os painéis se comem. */
export const MINIMO = { largura: 900, altura: 600 };

/**
 * Onde a janela deve nascer.
 *
 * **A posição guardada só vale se ainda couber numa tela.** Ele desconecta o
 * monitor externo e a janela voltaria para coordenadas que não existem mais —
 * abrindo fora da vista, sem nenhuma forma óbvia de trazê-la de volta. É um
 * defeito clássico de aplicativo de desktop, e o remédio é conferir contra as
 * telas de AGORA.
 *
 * `telas` são os retângulos de área útil de cada monitor.
 */
export function ondeAbrir(
  guardada: Retangulo | null,
  telas: readonly Retangulo[]
): Retangulo {
  if (guardada === null || telas.length === 0) return JANELA_PADRAO;

  const largura = Math.max(MINIMO.largura, Math.round(guardada.largura));
  const altura = Math.max(MINIMO.altura, Math.round(guardada.altura));

  // Basta um CANTO visível: exigir a janela inteira dentro de uma tela
  // recusaria posições legítimas de quem usa dois monitores lado a lado, ou
  // deixa a janela um pouco para fora de propósito.
  const cabe = telas.some(
    (t) =>
      guardada.x < t.x + t.largura &&
      guardada.x + largura > t.x &&
      guardada.y < t.y + t.altura &&
      guardada.y + altura > t.y
  );

  return cabe
    ? { x: Math.round(guardada.x), y: Math.round(guardada.y), largura, altura }
    : { ...JANELA_PADRAO, largura, altura };
}

/**
 * A URL que a janela carrega.
 *
 * Sempre `127.0.0.1`, e nunca `localhost`: em máquina com IPv6 o `localhost`
 * pode resolver para `::1`, e o servidor escuta em `127.0.0.1`. A janela ficaria
 * branca sem dizer por quê.
 */
export function enderecoDaJanela(porta: number): string {
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
    throw new Error(`Porta inválida para a janela: ${String(porta)}`);
  }
  return `http://127.0.0.1:${porta}/`;
}

/**
 * Se uma navegação pode acontecer DENTRO da janela.
 *
 * Tudo que não for o próprio servidor sai para o navegador do sistema. Sem esta
 * regra, um link num README aberto no preview levaria a janela da IDE para um
 * site qualquer — e de lá não há barra de endereços para voltar.
 */
export function ehDaPropriaIde(url: string, porta: number): boolean {
  try {
    const u = new URL(url);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      u.hostname === '127.0.0.1' &&
      u.port === String(porta)
    );
  } catch {
    return false;
  }
}
