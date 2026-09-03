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
 * com um banco dele — 105 tabelas SEM chave estrangeira — o mermaid
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
    const canto = cantoDoConteudo(svg, estado.escala);
    estado.escala = Math.min(1, (caixa.width - 24) / largura, (caixa.height - 24) / altura);
    estado.x = 12 - canto.x * estado.escala;
    estado.y = 12 - canto.y * estado.escala;
    aplicar();
  };

  /**
   * O tamanho de leitura, no canto do DESENHO — não no canto do SVG.
   *
   * O SVG do mermaid tem margem própria, e num diagrama largo o conteúdo começa
   * longe da origem: abrir em 100% no ponto (0,0) mostrava uma tela VAZIA, com
   * o desenho fora de vista. Ele viu isso e não soube dizer se estava travado,
   * carregando ou quebrado — e tinha razão, porque a tela não dizia.
   */
  const tamanhoReal = (): void => {
    const canto = cantoDoConteudo(svg, estado.escala);
    estado.escala = 1;
    estado.x = 12 - canto.x;
    estado.y = 12 - canto.y;
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
      e.preventDefault();
      const caixa = janela.getBoundingClientRect();
      // Ctrl aproxima; sem ele a roda NAVEGA o desenho.
      //
      // A primeira versão deixava a roda rolar a página, e isso só funciona
      // para um diagrama pequeno. Um banco dele tem 47 mil pixels de
      // largura — 105 tabelas soltas, que o mermaid enfileira numa linha só —
      // e atravessá-lo arrastando é sofrimento. Shift move na horizontal, que
      // é a convenção de qualquer tela que rola para o lado.
      if (e.ctrlKey || e.metaKey) {
        ampliar(e.deltaY < 0 ? PASSO : 1 / PASSO, e.clientX - caixa.left, e.clientY - caixa.top);
        return;
      }
      if (e.shiftKey) estado.x -= e.deltaY;
      else {
        estado.x -= e.deltaX;
        estado.y -= e.deltaY;
      }
      aplicar();
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

/**
 * Onde as ENTIDADES começam dentro do SVG.
 *
 * **Não é `svg.getBBox()`.** Aquilo inclui os `<defs>` — os marcadores de
 * cardinalidade, que o mermaid põe perto da origem e que não se desenham em
 * lugar nenhum. Num diagrama de 105 tabelas o `getBBox` dizia que o conteúdo
 * começava em (8, 8) enquanto a primeira entidade estava 870 px abaixo: a
 * janela abria enquadrando o canto de NADA, e o que ele via era um retângulo
 * vazio. Foi exatamente o que ele relatou.
 *
 * Aqui se mede o que se vê: o menor canto entre os nós de entidade. O
 * `getBoundingClientRect` é em pixels de tela, então divide-se pela escala em
 * vigor para voltar às unidades do desenho; a translação se cancela porque a
 * medida é RELATIVA ao próprio SVG.
 */
function cantoDoConteudo(svg: SVGSVGElement, escala: number): { x: number; y: number } {
  const entidades = svg.querySelectorAll<SVGGraphicsElement>('g.node, .er.entityBox');
  const base = svg.getBoundingClientRect();
  let canto: { x: number; y: number } | null = null;

  // O canto da MESMA entidade, e não o menor `x` com o menor `y`.
  //
  // Componente a componente, o `x` vinha da entidade mais à esquerda e o `y` da
  // mais alta — que num diagrama de 47 mil pixels estão a quarenta mil pixels
  // uma da outra. O ponto resultante não tem nada, e a janela abria vazia.
  for (const entidade of entidades) {
    const caixa = entidade.getBoundingClientRect();
    const x = (caixa.left - base.left) / escala;
    if (canto === null || x < canto.x) canto = { x, y: (caixa.top - base.top) / escala };
  }
  // Sem entidade reconhecível, a origem serve — é o comportamento antigo, e não
  // um erro: um diagrama que não seja ER tem outra estrutura.
  return canto ?? { x: 0, y: 0 };
}
