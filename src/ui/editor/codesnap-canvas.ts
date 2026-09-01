// CodeSnap: quem pinta.
//
// As cores saem do TEMA ATUAL da IDE (spec 075) — a foto tem de sair igual ao
// que está na tela, senão ela é a foto de outro editor.
//
// O realce vem do próprio Monaco, por `monaco.editor.colorize`, que devolve
// HTML com `<span class="mtk7">`. As classes vêm do tema carregado no Monaco, e
// por isso o mapa de classe→cor é lido do CSS de verdade, e não adivinhado.
import type * as monacoNS from 'monaco-editor';
import {
  centroDoCirculo, medir, semORecuoComum,
  type EstiloDaFoto,
} from '../../shared/codesnap';
import { tokens } from '../theme';
import type { Paleta } from '../../shared/temas';

/** Um pedaço de linha com uma cor só. */
interface Pedaco {
  readonly texto: string;
  readonly cor: string;
}

/**
 * Lê o HTML colorido do Monaco e devolve linha por linha, pedaço por pedaço.
 *
 * `colorize` devolve `<span class="mtkN">` separados por `<br/>`. As classes
 * são as do tema já carregado — resolvê-las pelo CSS é o que faz a foto sair
 * com as cores que ele está vendo, e não com uma segunda tabela que divergiria.
 */
function pedacosDe(html: string, corDoTexto: string, corDe: (classe: string) => string): Pedaco[][] {
  const caixa = document.createElement('div');
  caixa.innerHTML = html;

  const linhas: Pedaco[][] = [[]];
  const visitar = (no: Node): void => {
    if (no.nodeType === Node.TEXT_NODE) {
      const texto = no.textContent ?? '';
      if (texto !== '') {
        const pai = no.parentElement;
        const classe = pai === null ? '' : [...pai.classList].find((c) => c.startsWith('mtk')) ?? '';
        (linhas[linhas.length - 1] as Pedaco[]).push({
          texto,
          cor: classe === '' ? corDoTexto : corDe(classe),
        });
      }
      return;
    }
    if (no.nodeName === 'BR') {
      linhas.push([]);
      return;
    }
    for (const filho of [...no.childNodes]) visitar(filho);
  };
  for (const filho of [...caixa.childNodes]) visitar(filho);
  return linhas;
}

/**
 * A cor de uma classe `mtkN`, perguntando ao navegador.
 *
 * Um elemento de verdade dentro do editor de verdade: a classe só resolve
 * dentro do `.monaco-editor`, e um `<span>` solto no `<body>` voltaria preto.
 */
function leitorDeCores(corDoTexto: string): (classe: string) => string {
  const dentro = document.querySelector('.monaco-editor');
  const cache = new Map<string, string>();
  return (classe: string): string => {
    const guardada = cache.get(classe);
    if (guardada !== undefined) return guardada;
    if (dentro === null) return corDoTexto;
    const span = document.createElement('span');
    span.className = classe;
    span.style.display = 'none';
    dentro.appendChild(span);
    const cor = getComputedStyle(span).color || corDoTexto;
    span.remove();
    cache.set(classe, cor);
    return cor;
  };
}

function cantoArredondado(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, largura: number, altura: number, raio: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.arcTo(x + largura, y, x + largura, y + altura, raio);
  ctx.arcTo(x + largura, y + altura, x, y + altura, raio);
  ctx.arcTo(x, y + altura, x, y, raio);
  ctx.arcTo(x, y, x + largura, y, raio);
  ctx.closePath();
}

export interface PedidoDeFoto {
  readonly texto: string;
  readonly linguagem: string;
  readonly estilo: EstiloDaFoto;
  readonly paleta: Paleta;
  readonly monaco: typeof monacoNS;
}

/**
 * Desenha a foto e devolve o canvas pronto.
 *
 * A ordem importa: moldura, sombra, janelinha, enfeite, números e por último o
 * código — cada camada por cima da anterior, como o desenho pede.
 */
export async function desenharFoto({
  texto, linguagem, estilo, paleta, monaco,
}: PedidoDeFoto): Promise<HTMLCanvasElement> {
  const codigo = semORecuoComum(texto.replace(/\s+$/, ''));
  const html = await monaco.editor.colorize(codigo, linguagem, { tabSize: 4 });
  const corDoTexto = paleta.fg;
  const linhas = pedacosDe(html, corDoTexto, leitorDeCores(corDoTexto));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Este navegador não deu um canvas 2D.');

  // A MESMA fonte do editor: a foto de um trecho tem de sair com a letra que
  // ele está vendo, senão a largura da linha muda e a foto mente sobre o
  // alinhamento do código.
  const fonte = `${estilo.fontSize}px ${tokens.fontMono}`;
  ctx.font = fonte;
  const larguraDaLinha = (pedacos: Pedaco[]): number =>
    ctx.measureText(pedacos.map((p) => p.texto).join('')).width;
  const larguraDoTexto = Math.max(1, ...linhas.map(larguraDaLinha));
  const larguraDeUmDigito = ctx.measureText('0').width;

  const m = medir(linhas.length, larguraDoTexto, larguraDeUmDigito, estilo);
  canvas.width = Math.ceil(m.largura * estilo.escala);
  canvas.height = Math.ceil(m.altura * estilo.escala);
  ctx.scale(estilo.escala, estilo.escala);
  // A escala zera a fonte definida antes dela.
  ctx.font = fonte;
  ctx.textBaseline = 'top';

  // 1. A moldura: um degradê discreto, para a janelinha ter de onde se
  //    destacar. Fundo chapado deixaria a foto colada em qualquer página.
  const degrade = ctx.createLinearGradient(0, 0, m.largura, m.altura);
  degrade.addColorStop(0, paleta.bg);
  degrade.addColorStop(1, paleta.bgPanel);
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, m.largura, m.altura);

  // 2. A janelinha, com sombra.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = paleta.bgEditor;
  cantoArredondado(ctx, m.janelaX, m.janelaY, m.janelaLargura, m.janelaAltura, 10);
  ctx.fill();
  ctx.restore();

  // 3. Os três círculos.
  if (estilo.enfeiteDeJanela) {
    const cores = ['#ff5f56', '#ffbd2e', '#27c93f'];
    cores.forEach((cor, i) => {
      const c = centroDoCirculo(i, estilo);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.raio, 0, Math.PI * 2);
      ctx.fillStyle = cor;
      ctx.fill();
    });
  }

  // 4. Números e código, linha a linha.
  linhas.forEach((pedacos, i) => {
    const y = m.codigoY + i * estilo.lineHeight;
    if (estilo.numeros) {
      const numero = String(estilo.primeiraLinha + i);
      ctx.fillStyle = paleta.fgDim;
      // Alinhado à direita, como em toda margem de editor.
      const x = m.janelaX + estilo.recheio + m.larguraDosNumeros - 16
        - ctx.measureText(numero).width;
      ctx.fillText(numero, x, y);
    }
    let x = m.codigoX;
    for (const pedaco of pedacos) {
      ctx.fillStyle = pedaco.cor;
      ctx.fillText(pedaco.texto, x, y);
      x += ctx.measureText(pedaco.texto).width;
    }
  });

  return canvas;
}

/** O canvas virando um PNG. */
export function comoPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolver, rejeitar) => {
    canvas.toBlob((blob) => {
      if (blob === null) rejeitar(new Error('Não foi possível gerar o PNG.'));
      else resolver(blob);
    }, 'image/png');
  });
}

/**
 * Copia a imagem para a área de transferência.
 *
 * Só existe em contexto seguro — e `localhost` conta como um, então funciona
 * aqui. Quem não tiver a API recebe o erro, e a tela oferece salvar o arquivo.
 */
export async function copiarImagem(blob: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || navigator.clipboard?.write === undefined) {
    throw new Error('Este navegador não deixa copiar imagem. Use o "Salvar PNG".');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Baixa a imagem com o nome que `nomeDaFoto` deu. */
export function baixarImagem(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  // Sem o revoke o blob fica na memória até a aba fechar.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
