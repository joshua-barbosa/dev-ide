// CodeSnap: a foto de um trecho de código. A conta, sem o desenho.
//
// Pedido dele, e pelo nome da extensão que ele usa: *"uma extensão que tira
// foto de um trecho de código selecionado, se chama CodeSnap"*.
//
// **Nada de biblioteca de rasterizar HTML.** O caminho usual (`html2canvas`,
// ou um `<svg><foreignObject>` desenhado no canvas) traz dois problemas que
// esta IDE não precisa ter: fonte que não carrega dentro do SVG e canvas que
// fica "sujo" e não deixa mais copiar a imagem. Desenhando direto no canvas 2D
// tudo é nosso — e o que sai é igual em qualquer navegador.
//
// Este arquivo é a MEDIDA: onde cada coisa fica, e de que tamanho. Quem pinta
// é `ui/editor/codesnap-canvas.ts`, e quem mede o texto é o próprio canvas —
// por isso a largura entra como parâmetro em vez de ser calculada aqui.

import { nomeParaExibir } from './caminho-local';

export interface EstiloDaFoto {
  /** Tamanho da fonte do código, em pixels. */
  readonly fontSize: number;
  /** Altura de uma linha, já em pixels. */
  readonly lineHeight: number;
  /** Espaço entre o código e a borda da janelinha. */
  readonly recheio: number;
  /** Espaço entre a janelinha e a borda da imagem — é a moldura colorida. */
  readonly moldura: number;
  /** Mostrar os três círculos do alto. */
  readonly enfeiteDeJanela: boolean;
  /** Mostrar a coluna de números à esquerda. */
  readonly numeros: boolean;
  /** O número da primeira linha — é o do arquivo, não `1`. */
  readonly primeiraLinha: number;
  /** Multiplicador de resolução: 2 sai nítido em tela retina. */
  readonly escala: number;
}

/**
 * A altura de linha que o MONACO usaria para este tamanho de fonte.
 *
 * Ele deriva a altura da fonte quando ninguém fixa uma, e a razão é 1.35 no
 * Linux e no Windows. Fixar 1.5 aqui deixava a foto mais arejada que o editor —
 * parecido, mas não igual, que é justamente o que uma foto de tela não pode ser.
 */
export const alturaDeLinha = (fontSize: number): number => Math.round(fontSize * 1.35);

export const ESTILO_PADRAO: EstiloDaFoto = {
  fontSize: 14,
  lineHeight: alturaDeLinha(14),
  recheio: 20,
  moldura: 32,
  enfeiteDeJanela: true,
  numeros: true,
  primeiraLinha: 1,
  escala: 2,
};

/** Altura da faixa dos três círculos, quando ela existe. */
export const ALTURA_DO_ENFEITE = 28;
const RAIO_DO_CIRCULO = 6;
const ESPACO_ENTRE_CIRCULOS = 20;
/** Distância entre a coluna de números e o código. */
const RESPIRO_DOS_NUMEROS = 16;

export interface Medidas {
  /** Tamanho final da imagem, em pixels de CSS (antes da `escala`). */
  readonly largura: number;
  readonly altura: number;
  /** Canto superior esquerdo da janelinha. */
  readonly janelaX: number;
  readonly janelaY: number;
  readonly janelaLargura: number;
  readonly janelaAltura: number;
  /** Onde a primeira linha de código começa. */
  readonly codigoX: number;
  readonly codigoY: number;
  /** Largura reservada para os números; `0` quando eles estão desligados. */
  readonly larguraDosNumeros: number;
}

/**
 * Onde tudo fica.
 *
 * `larguraDoTexto` é a da linha mais larga, medida pelo canvas com a fonte de
 * verdade — medir por contagem de caracteres erraria em toda fonte que não
 * seja monoespaçada, e erraria feio com acento e emoji.
 */
export function medir(
  linhas: number,
  larguraDoTexto: number,
  larguraDeUmDigito: number,
  estilo: EstiloDaFoto
): Medidas {
  const digitos = String(estilo.primeiraLinha + Math.max(linhas - 1, 0)).length;
  const larguraDosNumeros = estilo.numeros
    ? Math.ceil(digitos * larguraDeUmDigito) + RESPIRO_DOS_NUMEROS
    : 0;

  const enfeite = estilo.enfeiteDeJanela ? ALTURA_DO_ENFEITE : 0;
  const janelaLargura = estilo.recheio * 2 + larguraDosNumeros + Math.ceil(larguraDoTexto);
  const janelaAltura = enfeite + estilo.recheio * 2 + linhas * estilo.lineHeight;

  return {
    largura: janelaLargura + estilo.moldura * 2,
    altura: janelaAltura + estilo.moldura * 2,
    janelaX: estilo.moldura,
    janelaY: estilo.moldura,
    janelaLargura,
    janelaAltura,
    codigoX: estilo.moldura + estilo.recheio + larguraDosNumeros,
    codigoY: estilo.moldura + enfeite + estilo.recheio,
    larguraDosNumeros,
  };
}

/** Onde fica o círculo `i` (0, 1, 2) da faixa de cima. */
export function centroDoCirculo(
  i: number,
  estilo: EstiloDaFoto
): { readonly x: number; readonly y: number; readonly raio: number } {
  return {
    x: estilo.moldura + estilo.recheio + RAIO_DO_CIRCULO + i * ESPACO_ENTRE_CIRCULOS,
    y: estilo.moldura + ALTURA_DO_ENFEITE / 2,
    raio: RAIO_DO_CIRCULO,
  };
}

/**
 * Tira a indentação que TODAS as linhas têm em comum.
 *
 * Selecionar um método no meio de uma classe traz oito espaços na frente de
 * cada linha, e a foto sairia com uma faixa vazia à esquerda. As linhas em
 * branco não entram na conta — senão qualquer linha vazia zeraria o recuo.
 */
export function semORecuoComum(texto: string): string {
  const linhas = texto.replace(/\t/g, '    ').split('\n');
  const comConteudo = linhas.filter((l) => l.trim() !== '');
  if (comConteudo.length === 0) return texto;
  const menor = Math.min(
    ...comConteudo.map((l) => l.length - l.trimStart().length)
  );
  return menor === 0 ? linhas.join('\n') : linhas.map((l) => l.slice(menor)).join('\n');
}

/**
 * O nome do arquivo que a foto vira.
 *
 * Leva o nome do arquivo de origem e a linha, porque foto de código sem
 * contexto vira `imagem-3.png` na pasta de downloads e ninguém acha depois.
 */
export function nomeDaFoto(caminho: string | null, primeiraLinha: number): string {
  const base = nomeParaExibir(caminho ?? 'trecho');
  const semExtensao = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const limpo = semExtensao.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${limpo === '' ? 'trecho' : limpo}-L${primeiraLinha}.png`;
}

/**
 * Duas cores em `#rrggbb` misturadas na proporção `quanto` (0 a 1).
 *
 * Existe para a moldura da foto: `bgPanel` puxado um tanto para a cor de
 * destaque dá um degradê que se enxerga, sem inventar cor que não está no tema.
 *
 * **Cor que não seja `#rgb` ou `#rrggbb` volta como veio.** Um tema do usuário
 * com uma cor escrita de outro jeito não pode derrubar a foto inteira — é a
 * mesma regra da spec 075 para cor inválida.
 */
export function misturarCores(a: string, b: string, quanto: number): string {
  const valida = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  if (!valida.test(a) || !valida.test(b)) return a;
  const ler = (c: string): readonly number[] => {
    const h = c.slice(1);
    const n = h.length === 3 ? h.split('').map((d) => d + d).join('') : h;
    return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16));
  };
  const [ra, ga, ba] = ler(a) as [number, number, number];
  const [rb, gb, bb] = ler(b) as [number, number, number];
  const m = (x: number, y: number): string =>
    Math.round(x + (y - x) * quanto).toString(16).padStart(2, '0');
  return `#${m(ra, rb)}${m(ga, gb)}${m(ba, bb)}`;
}
