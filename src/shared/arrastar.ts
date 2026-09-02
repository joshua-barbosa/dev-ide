// Arrastar e soltar: o que vai no arraste e onde ele cai.
//
// Duas coisas puras que a interface precisa e que erram na prática: **qual zona
// o cursor está tocando** (o cálculo de borda, com o problema dos cantos) e
// **como a carga viaja** entre a árvore de arquivos, a barra de abas e a área de
// editor.
//
// Ficam aqui porque as duas são aritmética e texto — testáveis sem navegador,
// que é onde arrastar é caro de verificar.
import type { Lado } from './layout-editor';

/** `centro` abre no próprio grupo; os demais dividem naquele lado. */
export type Zona = Lado | 'centro';

/**
 * Quanto de cada borda conta como "dividir".
 *
 * Um quarto de cada lado deixa metade da área central para o caso comum — abrir
 * no grupo em que se soltou. Menos que isso e a divisão vira sorte; mais e não
 * sobra centro.
 */
export const FRACAO_DE_BORDA = 0.25;

export interface Retangulo {
  readonly x: number;
  readonly y: number;
  readonly largura: number;
  readonly altura: number;
}

/**
 * A zona que o ponto toca dentro do retângulo.
 *
 * **O canto é o caso que erra.** Perto de `(0, 0)` o ponto está a menos de um
 * quarto da borda esquerda E da de cima; testar as bordas em sequência daria
 * sempre a primeira do `if`, e o usuário veria "esquerda" ao mirar em "cima". A
 * saída é comparar as quatro distâncias e ficar com a MENOR.
 */
export function zonaDoPonto(r: Retangulo, x: number, y: number): Zona {
  if (r.largura <= 0 || r.altura <= 0) return 'centro';

  // Fora do retângulo conta como na borda: arrastar depressa passa do alvo, e
  // recusar por um pixel seria punir a mão.
  const rx = Math.min(Math.max((x - r.x) / r.largura, 0), 1);
  const ry = Math.min(Math.max((y - r.y) / r.altura, 0), 1);

  const candidatos: ReadonlyArray<readonly [Lado, number]> = [
    ['esquerda', rx],
    ['direita', 1 - rx],
    ['cima', ry],
    ['baixo', 1 - ry],
  ];

  let melhor: readonly [Lado, number] = candidatos[0] as readonly [Lado, number];
  for (const c of candidatos) if (c[1] < melhor[1]) melhor = c;

  return melhor[1] < FRACAO_DE_BORDA ? melhor[0] : 'centro';
}

// ---------------------------------------------------------------------------
// A carga do arraste
// ---------------------------------------------------------------------------

/**
 * Tipo MIME próprio.
 *
 * Não é `text/plain` de propósito: assim um arraste vindo de fora da IDE — um
 * arquivo do sistema, um texto de outra aba do navegador — não é confundido com
 * um dos nossos. E durante o `dragover` o navegador só deixa ler os TIPOS, não
 * o conteúdo; ter um tipo só nosso é o que permite decidir se mostra o indicador.
 */
export const MIME_DE_ARRASTE = 'application/x-dev-ide-item';

export type CargaDeArraste =
  /**
   * Um item da árvore de arquivos.
   *
   * `pasta` distingue os dois casos (T090): o editor não abre pasta, e o SFTP
   * sobe o conteúdo dela. Sem a marca, quem recebe teria de ir perguntar ao
   * disco o que acabou de receber.
   */
  | { readonly tipo: 'arquivo'; readonly caminho: string; readonly pasta?: boolean }
  | { readonly tipo: 'aba'; readonly id: string };

export function codificarCarga(carga: CargaDeArraste): string {
  return JSON.stringify(carga);
}

/** Devolve `null` para qualquer coisa que não seja uma carga nossa. */
export function decodificarCarga(bruto: string): CargaDeArraste | null {
  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;

  const r = json as Record<string, unknown>;
  if (r.tipo === 'arquivo' && typeof r.caminho === 'string' && r.caminho !== '') {
    return { tipo: 'arquivo', caminho: r.caminho, ...(r.pasta === true ? { pasta: true } : {}) };
  }
  if (r.tipo === 'aba' && typeof r.id === 'string' && r.id !== '') {
    return { tipo: 'aba', id: r.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reordenar abas (T029)
// ---------------------------------------------------------------------------

/**
 * Antes de qual aba a arrastada deve entrar.
 *
 * Recebe a fila do grupo, a aba que está sob o cursor e de que metade dela o
 * cursor está. Metade esquerda quer dizer "antes desta"; metade direita quer
 * dizer "antes da PRÓXIMA" — e, quando não há próxima, `null`, que o store lê
 * como fim da fila.
 *
 * Existe separado do componente porque é aritmética de índice, que é onde
 * arrastar-e-soltar erra: um a mais ou a menos só aparece em metade dos gestos,
 * e verificar isso no navegador é caro.
 */
export function alvoDaInsercao(
  fila: readonly string[],
  indice: number,
  metadeDireita: boolean
): string | null {
  if (indice < 0 || indice >= fila.length) return null;
  return (metadeDireita ? fila[indice + 1] : fila[indice]) ?? null;
}

/** De que metade horizontal do retângulo o ponto está. */
export function ehMetadeDireita(r: Retangulo, x: number): boolean {
  if (r.largura <= 0) return false;
  return x - r.x >= r.largura / 2;
}
