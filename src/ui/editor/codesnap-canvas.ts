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
  centroDoCirculo, medir, misturarCores, semORecuoComum,
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

/**
 * Escreve um pedaço CARACTERE A CARACTERE, e devolve onde parou.
 *
 * Parece desperdício, e não é: a fonte do editor é a Fira Code, que tem
 * **ligaduras**. Num `fillText` de uma vez, `--no-cache-dir` sai com um traço
 * longo e `==9.7.6` sai com um `═` — e o Monaco desenha os dois caracteres
 * separados, porque `fontLigatures` vem desligado. A foto ficava mostrando um
 * código diferente do que está na tela, e quem copiasse da imagem leria errado.
 *
 * O canvas 2D não tem como desligar ligadura: `letterSpacing` não resolve
 * (testado), e não existe `font-feature-settings` aqui. Uma chamada por
 * caractere resolve, porque cada uma é uma composição independente.
 *
 * A iteração é por `of`, e não por índice: assim um emoji ou um acento composto
 * sai inteiro em vez de partido ao meio.
 */
function escrever(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number): number {
  let cursor = x;
  for (const caractere of texto) {
    ctx.fillText(caractere, cursor, y);
    cursor += ctx.measureText(caractere).width;
  }
  return cursor;
}

/** A largura de um texto pela MESMA conta do desenho — soma por caractere. */
function largura(ctx: CanvasRenderingContext2D, texto: string): number {
  let total = 0;
  for (const caractere of texto) total += ctx.measureText(caractere).width;
  return total;
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
  // Medida pela mesma conta do desenho: com ligadura, medir a linha inteira e
  // desenhar caractere a caractere daria dois números diferentes, e a janelinha
  // ficaria estreita demais para o que ela contém.
  const larguraDaLinha = (pedacos: Pedaco[]): number =>
    largura(ctx, pedacos.map((p) => p.texto).join(''));
  const larguraDoTexto = Math.max(1, ...linhas.map(larguraDaLinha));
  const larguraDeUmDigito = largura(ctx, '0');

  const m = medir(linhas.length, larguraDoTexto, larguraDeUmDigito, estilo);
  canvas.width = Math.ceil(m.largura * estilo.escala);
  canvas.height = Math.ceil(m.altura * estilo.escala);
  ctx.scale(estilo.escala, estilo.escala);
  // A escala zera a fonte definida antes dela.
  ctx.font = fonte;
  ctx.textBaseline = 'top';

  // 1. A moldura: degradê com um FIO da cor de destaque no meio. Antes ele ia
  //    de `bg` a `bgPanel`, que num tema escuro são dois cinzas quase iguais — o
  //    resultado era um retângulo chapado, e a janelinha não tinha de onde se
  //    destacar. A cor de destaque é a do tema dele, então a foto continua sendo
  //    a cara da IDE dele, e não uma moldura genérica.
  const degrade = ctx.createLinearGradient(0, 0, m.largura, m.altura);
  degrade.addColorStop(0, paleta.bg);
  degrade.addColorStop(0.5, misturarCores(paleta.bgPanel, paleta.accent, 0.14));
  degrade.addColorStop(1, paleta.bg);
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, m.largura, m.altura);

  // 2. A janelinha, com sombra e um fio de contorno.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = paleta.bgEditor;
  cantoArredondado(ctx, m.janelaX, m.janelaY, m.janelaLargura, m.janelaAltura, 10);
  ctx.fill();
  ctx.restore();
  // O fio existe porque em tema escuro a janela e a moldura são dois cinzas
  // parecidos, e sem ele a foto vira um retângulo chapado sem borda visível.
  ctx.save();
  ctx.strokeStyle = paleta.border;
  ctx.lineWidth = 1;
  cantoArredondado(ctx, m.janelaX + 0.5, m.janelaY + 0.5, m.janelaLargura - 1, m.janelaAltura - 1, 10);
  ctx.stroke();
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
      const x = m.janelaX + estilo.recheio + m.larguraDosNumeros - 16 - largura(ctx, numero);
      escrever(ctx, numero, x, y);
    }
    let x = m.codigoX;
    for (const pedaco of pedacos) {
      ctx.fillStyle = pedaco.cor;
      x = escrever(ctx, pedaco.texto, x, y);
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
