// Zoom e arrasto num diagrama do preview (spec 069, correção).
//
// Nasceu de uma reclamação exata dele, com print: *"como que eu iria dar zoom
// na tela para enxergar isso?!"*. Um diagrama de 40 tabelas cabia na largura da
// aba e virava uma fileira de retângulos ilegíveis — entregar uma figura que
// não dá para ler é o mesmo que não entregar.
//
// Mexe no DOM direto, e não em React, porque o bloco veio de
// `dangerouslySetInnerHTML`: o preview inteiro é HTML gerado, e enfiar um
// componente no meio dele exigiria reescrever o renderizador de markdown.

/** Limites do zoom. Abaixo de 0.2 nada se lê; acima de 8 o SVG serrilha. */
const MINIMO = 0.2;
const MAXIMO = 8;
const PASSO = 1.25;

interface Estado {
  escala: number;
  x: number;
  y: number;
}

/**
 * Liga zoom, arrasto e a barra de controles num nó de diagrama já desenhado.
 *
 * **Nasce em 100%, e não enquadrado.** A primeira versão abria em `ajustar`, e
 * com o `banco-grande` dele — 105 tabelas SEM chave estrangeira — o mermaid
 * enfileira tudo numa linha só: caber na largura dava uma tarja de 2% de
 * tamanho, ilegível. Cem por cento é o único tamanho que se garante legível; a
 * visão geral virou o botão `ajustar`, que é onde ela cabe.
 */
export function ligarZoom(no: HTMLElement): void {
  const svg = no.querySelector('svg');
  if (svg === null || no.dataset.zoomLigado === 'sim') return;
  no.dataset.zoomLigado = 'sim';

  // O SVG do mermaid vem com `max-width` embutido, que é justamente o que o
  // espremia até virar tarja. Aqui ele passa a ter o tamanho que tem.
  const largura = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width;
  const altura = svg.viewBox.baseVal.height || svg.getBoundingClientRect().height;
  svg.style.maxWidth = 'none';
  svg.style.width = `${largura}px`;
  svg.style.height = `${altura}px`;

  const palco = document.createElement('div');
  palco.style.transformOrigin = '0 0';
  palco.append(svg);

  const janela = document.createElement('div');
  janela.dataset.janelaDoDiagrama = 'sim';
  janela.style.position = 'relative';
  janela.style.overflow = 'hidden';
  janela.style.height = '70vh';
  janela.style.border = '1px solid rgba(127,127,127,0.25)';
  janela.style.borderRadius = '4px';
  janela.style.cursor = 'grab';
  janela.append(palco);

  const estado: Estado = { escala: 1, x: 0, y: 0 };
  const aplicar = (): void => {
    palco.style.transform = `translate(${estado.x}px, ${estado.y}px) scale(${estado.escala})`;
  };

  const ajustar = (): void => {
    const caixa = janela.getBoundingClientRect();
    if (caixa.width === 0 || largura === 0) return;
    // `min` com 1: um diagrama pequeno não é ESTICADO até encher a janela —
    // ampliar um desenho de duas tabelas até a tela inteira é grotesco.
    estado.escala = Math.min(1, (caixa.width - 24) / largura, (caixa.height - 24) / altura);
    estado.x = Math.max(0, (caixa.width - largura * estado.escala) / 2);
    estado.y = 12;
    aplicar();
  };

  /** O tamanho de leitura, no canto de cima à esquerda. É como a janela abre. */
  const tamanhoReal = (): void => {
    estado.escala = 1;
    estado.x = 12;
    estado.y = 12;
    aplicar();
  };

  /** Aproxima MIRANDO um ponto: sem isto o zoom foge do que se quer ver. */
  const ampliar = (fator: number, alvoX: number, alvoY: number): void => {
    const nova = Math.min(MAXIMO, Math.max(MINIMO, estado.escala * fator));
    const razao = nova / estado.escala;
    estado.x = alvoX - (alvoX - estado.x) * razao;
    estado.y = alvoY - (alvoY - estado.y) * razao;
    estado.escala = nova;
    aplicar();
  };

  janela.addEventListener(
    'wheel',
    (e) => {
      // Roda SEM modificador rola a página, como em qualquer documento. Com
      // Ctrl ela aproxima — é o gesto que todo mapa e todo editor já usam.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const caixa = janela.getBoundingClientRect();
      ampliar(e.deltaY < 0 ? PASSO : 1 / PASSO, e.clientX - caixa.left, e.clientY - caixa.top);
    },
    { passive: false }
  );

  let arrastando = false;
  let ultimoX = 0;
  let ultimoY = 0;
  janela.addEventListener('pointerdown', (e) => {
    arrastando = true;
    ultimoX = e.clientX;
    ultimoY = e.clientY;
    janela.style.cursor = 'grabbing';
    janela.setPointerCapture(e.pointerId);
  });
  janela.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    estado.x += e.clientX - ultimoX;
    estado.y += e.clientY - ultimoY;
    ultimoX = e.clientX;
    ultimoY = e.clientY;
    aplicar();
  });
  const soltar = (e: PointerEvent): void => {
    arrastando = false;
    janela.style.cursor = 'grab';
    if (janela.hasPointerCapture(e.pointerId)) janela.releasePointerCapture(e.pointerId);
  };
  janela.addEventListener('pointerup', soltar);
  janela.addEventListener('pointercancel', soltar);

  janela.append(barra([
    ['Aproximar o diagrama', '+', () => comCentro(janela, (x, y) => ampliar(PASSO, x, y))],
    ['Afastar o diagrama', '−', () => comCentro(janela, (x, y) => ampliar(1 / PASSO, x, y))],
    ['Tamanho real do diagrama', '100%', tamanhoReal],
    ['Enquadrar o diagrama inteiro', 'ajustar', ajustar],
  ]));

  no.append(janela);
  tamanhoReal();
}

function comCentro(janela: HTMLElement, acao: (x: number, y: number) => void): void {
  const caixa = janela.getBoundingClientRect();
  acao(caixa.width / 2, caixa.height / 2);
}

function barra(
  itens: readonly [string, string, () => void][]
): HTMLElement {
  const caixa = document.createElement('div');
  caixa.style.position = 'absolute';
  caixa.style.top = '8px';
  caixa.style.right = '8px';
  caixa.style.display = 'flex';
  caixa.style.gap = '4px';
  caixa.style.zIndex = '2';

  for (const [rotulo, texto, acao] of itens) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', rotulo);
    b.textContent = texto;
    b.style.cssText =
      'font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer;' +
      'background: rgba(0,0,0,0.45); color: inherit;' +
      'border: 1px solid rgba(127,127,127,0.35); border-radius: 4px;';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      acao();
    });
    // O arrasto do palco não pode começar num clique no botão.
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    caixa.append(b);
  }
  return caixa;
}
