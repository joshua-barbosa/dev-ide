// As células que não couberam no orçamento da página, endereçadas por posição.
//
// A chave é `"linha:coluna"` com os índices da PÁGINA COMO O DRIVER A MONTOU.
// A tela filtra linhas (a busca da aba não reescreve SQL: ela esconde o que já
// veio), e aí a linha 7 vira a linha 2 — sem remapear, a lupa avisaria corte na
// célula errada, que é pior que não avisar.
export type Cortes = Readonly<Record<string, number>>;

/**
 * Quanto texto uma página de resultado pode trazer, em caracteres.
 *
 * 8 MB medidos: 500 linhas com um JSON de 16 KB em cada dão 8,07 MB — o caso
 * comum cabe inteiro, e é ele que estava sendo cortado em 2048. Uma página de
 * JSON de 256 KB daria 128 MB, e essa não cabe: as primeiras vêm inteiras e o
 * resto vem como amostra marcada. Ele muda o valor no painel de aparência.
 *
 * Mora aqui, e não no driver, porque a TELA também precisa dele: é ela que
 * manda o número no pedido.
 */
export const ORCAMENTO_PADRAO = 8 * 1024 * 1024;

/** As opções do painel de aparência, em caracteres. */
export const ORCAMENTOS: readonly { readonly valor: number; readonly rotulo: string }[] = [
  { valor: 2 * 1024 * 1024, rotulo: '2 MB' },
  { valor: ORCAMENTO_PADRAO, rotulo: '8 MB' },
  { valor: 32 * 1024 * 1024, rotulo: '32 MB' },
  { valor: 128 * 1024 * 1024, rotulo: '128 MB' },
];

export const SEM_CORTES: Cortes = {};

export function tamanhoRealDe(
  cortes: Cortes | undefined,
  linha: number,
  coluna: number
): number | null {
  return cortes?.[`${linha}:${coluna}`] ?? null;
}

/**
 * Reescreve as chaves para a ordem que a tela mostra.
 *
 * `visiveis[k]` é a linha `original[k]` da página. O que não está na lista
 * simplesmente some — a célula não está na tela para ter aviso.
 */
export function remapearCortes(cortes: Cortes | undefined, original: readonly number[]): Cortes {
  if (cortes === undefined) return SEM_CORTES;
  const chaves = Object.keys(cortes);
  if (chaves.length === 0) return SEM_CORTES;

  const novaPosicao = new Map(original.map((de, para) => [de, para]));
  const saida: Record<string, number> = {};
  for (const chave of chaves) {
    const [linha, coluna] = chave.split(':');
    const nova = novaPosicao.get(Number(linha));
    if (nova !== undefined) saida[`${nova}:${coluna}`] = cortes[chave];
  }
  return saida;
}
