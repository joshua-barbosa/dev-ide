// Comparação de imagem: o remédio para o defeito que mais o atingiu (T098).
//
// A nota dele é a razão: *"a comparação de imagem é o remédio para a classe de
// defeito que mais o atingiu — o botão fora da tela e a estrela virada chave"*.
// São defeitos que TODA asserção de DOM aprova: o botão existe, tem o rótulo
// certo, responde ao clique — e está fora da área visível. Só a imagem pega.
//
// **Este arquivo é o que mais pode apodrecer a suíte, e por isso ele é estrito
// consigo mesmo.** Um teste de imagem ingênuo falha por qualquer coisa: uma
// fonte que carrega meio quadro depois, um cursor que pisca, um relógio. Quatro
// regras, todas por causa disso:
//
// 1. **Compara REGIÃO, não a página.** Uma diferença numa barra de 30 px é
//    legível; uma diferença numa tela inteira obriga a caçar o pixel.
// 2. **Congela o que se mexe** — animações, transições e o piscar do cursor.
// 3. **Espera as FONTES.** A largura de um botão muda quando a fonte troca, e
//    esse é o quadro em que a captura costuma cair.
// 4. **Tolerância pequena, e não zero.** O antisserrilhado de texto varia entre
//    execuções na mesma máquina; exigir zero é pedir para o teste mentir.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, esperarIdePronta } from './fixtures';

/**
 * Deixa a tela parada e previsível.
 *
 * Sem isto a captura pega o meio de uma transição — e o teste passa ou falha
 * pelo relógio, que é o pior tipo de teste que existe.
 */
async function congelar(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* O cursor do Monaco pisca sozinho, fora do CSS de transição. */
      .monaco-editor .cursor { visibility: hidden !important; }
    `,
  });
  // As fontes decidem a LARGURA de tudo: capturar antes delas mede outra tela.
  await page.evaluate(() => document.fonts.ready);
}

/** A mesma janela em toda execução: largura diferente, layout diferente. */
test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a barra de status cabe na tela, com todos os botões (T098)', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await congelar(page);

  const barra = page.locator('[data-barra-de-status]');
  await expect(barra).toBeVisible();
  await expect(barra).toHaveScreenshot('barra-de-status.png', {
    maxDiffPixelRatio: 0.02,
  });
});

test('nenhum botão da barra de status vaza para fora da janela (T098)', async ({ page }) => {
  // A imagem pega a MUDANÇA; esta asserção pega o defeito na primeira vez, sem
  // precisar de uma imagem de referência anterior. As duas se completam: uma
  // guarda o que já está certo, a outra descreve o que "certo" quer dizer.
  await abrirArquivo(page, 'utils.ts');

  const vazando = await page.evaluate(() => {
    const barra = document.querySelector('[data-barra-de-status]');
    if (barra === null) return ['barra de status não existe'];
    const limite = document.documentElement.clientWidth;
    return [...barra.children]
      .map((f) => ({ texto: (f as HTMLElement).innerText.trim(), r: f.getBoundingClientRect() }))
      .filter((f) => f.r.width > 0 && (f.r.right > limite + 1 || f.r.left < -1))
      .map((f) => `${f.texto || '(sem texto)'} em ${Math.round(f.r.left)}..${Math.round(f.r.right)} de ${limite}`);
  });

  expect(vazando).toEqual([]);
});

test('a barra de abas com o arquivo aberto (T098)', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await congelar(page);

  await expect(page.locator('[data-barra-de-abas]')).toHaveScreenshot('barra-de-abas.png', {
    maxDiffPixelRatio: 0.02,
  });
});

test('o painel inferior aberto na aba Problems (T098)', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  // `Ctrl+J` ALTERNA, e o painel continua no DOM quando escondido (esconder é
  // `display: none`, nunca desmontar). Apertá-lo às cegas o fecharia.
  const painel = page.locator('[data-painel-inferior]');
  if (!(await painel.isVisible())) await page.keyboard.press('Control+j');
  await expect(painel).toBeVisible();
  await page.locator('[data-aba-painel="problems"]').click();
  await congelar(page);

  await expect(painel).toHaveScreenshot('painel-problems.png', {
    // O painel tem hora nos problemas, então a área que muda sozinha é
    // MASCARADA em vez de tolerada: mascarar é exato, tolerar é chute.
    mask: [painel.locator('[data-problema] > *:last-child')],
    maxDiffPixelRatio: 0.02,
  });
});
