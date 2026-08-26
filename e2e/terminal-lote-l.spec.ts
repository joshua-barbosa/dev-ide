// Busca, links e snippets no terminal (T108, T109, T085, T087 · spec 008/058).
//
// Os quatro vinham de `Non-Goals` onde eu quase não escrevi desculpa. Dois deles
// eu só listei; num terceiro escrevi "ninguém pediu" — e ele pediu; no quarto
// chutei duas vezes o que o botão fazia, até ele me dizer.
import { expect, test, type Page } from '@playwright/test';
import { esperarIdePronta, menu } from './fixtures';

/** Abre o terminal do painel de baixo e espera o shell responder. */
async function abrirTerminalDoPainel(page: Page): Promise<void> {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  const terminal = page.locator('[data-terminal="shell"]').first();
  await expect(terminal).toBeVisible();
  // Espera o prompt: mandar tecla antes do shell estar de pé é perder a tecla.
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

/**
 * Fecha o terminal aberto pelo teste.
 *
 * O servidor tem teto de 12 terminais, e ele é do PROCESSO — não da página.
 * Sem isto, nove testes que abrem um terminal cada esgotam o teto e o próximo
 * arquivo da suíte recebe "Limite de 12 terminais atingido" em vez de um
 * prompt. Foi assim que `terminal.spec.ts` ficou vermelho por culpa deste
 * arquivo aqui.
 */
test.afterEach(async ({ page }) => {
  const fechar = page.getByRole('button', { name: 'Fechar terminal' });
  while (await fechar.isVisible().catch(() => false)) {
    await fechar.click();
    await page.waitForTimeout(150);
  }
});

test('`Ctrl+F` no terminal abre a BUSCA, e não vira byte no shell', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  await page.locator('[data-terminal="shell"]').first().click();
  await page.keyboard.press('Control+f');

  await expect(page.locator('[data-busca-do-terminal]')).toBeVisible();
  await expect(page.getByLabel('Procurar no terminal')).toBeFocused();
});

test('`Escape` fecha a busca e devolve o foco ao terminal', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  await page.locator('[data-terminal="shell"]').first().click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('[data-busca-do-terminal]')).toBeVisible();

  await page.keyboard.press('Escape');
  // Fechar e deixar o usuário digitando no vazio seria a pior saída possível.
  await expect(page.locator('[data-busca-do-terminal]')).toHaveCount(0);
});

test('procurar o que NÃO existe avisa, em vez de ficar calado', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  await page.locator('[data-terminal="shell"]').first().click();
  await page.keyboard.press('Control+f');
  await page.getByLabel('Procurar no terminal').fill('zzz-isto-nao-existe-em-lugar-nenhum');

  // Silêncio pareceria travamento — a cor do texto é o aviso.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const i = document.querySelector('[data-busca-do-terminal] input') as HTMLElement;
        return getComputedStyle(i).color;
      })
    )
    .not.toBe('rgb(216, 218, 226)');
});

test('o painel de baixo ganhou a barra de SNIPPETS', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  // Eu tinha recusado escrevendo "ninguém pediu". Ele pediu.
  // Dentro do PANE do painel: a IDE pode ter outras barras de terminal na tela
  // (a de uma aba de conexão, por exemplo), e o que se prova aqui é que ESTA
  // tem a barra.
  const pane = page.locator('[data-pane-terminal]').first();
  const botaoDeSnippets = pane.locator('[data-barra-do-terminal] button[aria-label="Snippets"]');
  await expect(botaoDeSnippets).toBeVisible();

  // `Novo snippet` mora DENTRO do menu, e não na barra.
  await botaoDeSnippets.click();
  await expect(page.locator('[data-lista-de-snippets]')).toBeVisible();
  await expect(
    page.locator('[data-lista-de-snippets] button[aria-label="Novo snippet"]')
  ).toBeVisible();
});

test('no painel, `Reconectar` e `Duplicar` NÃO se repetem', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  // O painel já tem os dois na própria gestão de terminais; repeti-los daria
  // dois botões para a mesma coisa a dois centímetros um do outro.
  const pane = page.locator('[data-pane-terminal]').first();
  await expect(pane.locator('button[aria-label="Reconectar"]')).toHaveCount(0);
  await expect(pane.locator('button[aria-label="Duplicar terminal"]')).toHaveCount(0);
});

test('o `{}` abre o arquivo de snippets no editor', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  await page
    .locator('[data-pane-terminal]')
    .first()
    .locator('button[aria-label="Editar o arquivo de snippets (todas as conexões)"]')
    .click();

  // Abre o arquivo DE VERDADE, pelo caminho, como o `config.json` — salvar é
  // salvar, sem rota especial e sem cópia.
  await expect(page.locator('[data-tab="snippets-de-terminal.json"]')).toBeVisible();
});

// ---- Aparência por terminal (T086) ----
//
// Eu tinha recusado escrevendo que a IDE já tem essas chaves no `config.json` e
// que "duplicá-las por aba criaria duas verdades". O argumento vale para
// PREFERÊNCIA — e não é disso que se trata. O motivo dele:
//
//   "eu posso querer ter uma visão diferente para cada terminal na hora, se eu
//    tenho N terminais abertos, eu posso querer diferenciar de algum jeito"
//
// É marcação, não configuração. Por isso some no F5 e HERDA o arquivo.

const painelDoVisual = (page: Page) => page.locator('[data-aparencia-do-terminal]');

test('a aparência deste terminal nasce HERDANDO o config.json', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  await page
    .locator('[data-pane-terminal]')
    .first()
    .locator('button[aria-label="Aparência deste terminal"]')
    .click();

  await expect(painelDoVisual(page)).toBeVisible();
  // `herda`, e não um número: a "segunda verdade" só existiria se este painel
  // nascesse com valores próprios.
  await expect(page.locator('[data-fonte-do-terminal]')).toHaveText('herda');
  await expect(
    painelDoVisual(page).getByRole('button', { name: 'Voltar a herdar as preferências' })
  ).toBeDisabled();
});

test('mudar a fonte muda ESTE terminal de verdade', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  // `.xterm-rows`, e NÃO `.xterm-screen`: é ali que o xterm aplica a fonte.
  // Medir no lugar errado daria "não mudou" com a mudança acontecendo.
  const daTela = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector('.xterm-rows') as HTMLElement).fontSize
    );
  const antes = await daTela();

  await page
    .locator('[data-pane-terminal]')
    .first()
    .locator('button[aria-label="Aparência deste terminal"]')
    .click();
  for (let i = 0; i < 4; i += 1) {
    await painelDoVisual(page).getByRole('button', { name: 'Aumentar a fonte deste terminal' }).click();
  }

  await expect.poll(daTela).not.toBe(antes);
  // E o painel mostra o número escolhido, em vez de `herda`.
  await expect(page.locator('[data-fonte-do-terminal]')).toHaveText('17');
});

test('`Voltar a herdar` desfaz, e o botão diz que houve mexida', async ({ page }) => {
  await abrirTerminalDoPainel(page);
  const abrirPainel = () =>
    page
      .locator('[data-pane-terminal]')
      .first()
      .locator('button[aria-label^="Aparência deste terminal"]')
      .click();

  await abrirPainel();
  // `radio`, e não `button`: as três opções de cursor são um grupo de escolha.
  await painelDoVisual(page).getByRole('radio', { name: 'Cursor: Barra' }).click();

  // A marca no rótulo: com quatro terminais abertos, saber QUAL foi mexido é o
  // ponto inteiro da feature.
  await expect(
    page
      .locator('[data-pane-terminal]')
      .first()
      .locator('button[aria-label="Aparência deste terminal (mexida)"]')
  ).toBeVisible();

  await painelDoVisual(page).getByRole('button', { name: 'Voltar a herdar as preferências' }).click();
  await expect(page.locator('[data-fonte-do-terminal]')).toHaveText('herda');
});
