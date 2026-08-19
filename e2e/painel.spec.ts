// Painel inferior: abas, terminais e visibilidade (spec 014).
//
// Estes testes mexem em estado guardado no navegador (visibilidade e altura do
// painel) e abrem terminais, que são processos. Cada um devolve o que mudou.
import { expect, test, type Page } from '@playwright/test';
import { editor, menu, saida } from './fixtures';

const painel = (page: Page) => page.locator('[data-painel-inferior]');
const abaDoPainel = (page: Page, id: string) => page.locator(`[data-aba-painel="${id}"]`);
const lateral = (page: Page) => page.getByRole('tab', { name: 'Arquivos' });

/** O conteúdo do terminal ativo. */
async function textoDoTerminal(page: Page): Promise<string> {
  return page.evaluate(() => {
    const visivel = [...document.querySelectorAll('[data-terminal]')]
      .find((e) => (e as HTMLElement).offsetParent !== null);
    return visivel === undefined ? '' : (visivel as HTMLElement).innerText;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Estado limpo: outro teste pode ter deixado o painel escondido.
  await page.evaluate(() => {
    localStorage.removeItem('dev-ide.painel-visivel');
    localStorage.removeItem('dev-ide.lateral-visivel');
    localStorage.removeItem('dev-ide.painel-aba');
  });
  await page.reload();
});

test('o painel tem Output, Problems e Terminal — e nenhum Debug Console', async ({ page }) => {
  for (const id of ['output', 'problems', 'terminal']) {
    await expect(abaDoPainel(page, id)).toBeVisible();
  }
  // Ele pressupõe depurador, que a IDE decidiu não ter.
  await expect(page.locator('[data-aba-painel="debug"]')).toHaveCount(0);
});

test('Ctrl+J esconde e mostra o painel, e a escolha sobrevive ao recarregar', async ({ page }) => {
  await expect(painel(page)).toBeVisible();

  await page.keyboard.press('Control+j');
  await expect(painel(page)).toBeHidden();

  await page.reload();
  await expect(painel(page)).toBeHidden();

  await page.keyboard.press('Control+j');
  await expect(painel(page)).toBeVisible();
});

test('Ctrl+B esconde e mostra a barra lateral', async ({ page }) => {
  await expect(lateral(page)).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(lateral(page)).toBeHidden();
  await page.keyboard.press('Control+b');
  await expect(lateral(page)).toBeVisible();
});

test('o botão da barra de menu esconde o painel, com a dica dizendo o verbo', async ({ page }) => {
  const botao = page.getByRole('button', { name: 'Esconder o painel inferior' });
  await expect(botao).toBeVisible();
  await botao.click();

  await expect(painel(page)).toBeHidden();
  // A dica muda junto: é o próximo clique que ela descreve.
  await expect(page.getByRole('button', { name: 'Mostrar o painel inferior' })).toBeVisible();
  await page.keyboard.press('Control+j');
});

test('New Terminal abre NO PAINEL, e não como aba do editor (decisão D6)', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();

  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toBeVisible();
  // O que mudou na spec 014: antes isto abria uma aba do editor.
  await expect(page.locator('[data-tab="Terminal"]')).toHaveCount(0);

  await expect.poll(() => textoDoTerminal(page), { timeout: 15_000 }).toMatch(/\$/);
});

test('dois terminais: alternar preserva o processo e o que já foi escrito', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await expect.poll(() => textoDoTerminal(page), { timeout: 15_000 }).toMatch(/\$/);

  await page.locator('[data-terminal]:visible').click();
  await page.keyboard.type('marca-do-primeiro');
  await expect.poll(() => textoDoTerminal(page)).toMatch(/marca-do-primeiro/);

  await page.getByRole('button', { name: 'Novo terminal' }).click();
  await expect(page.locator('[data-terminal-item="Terminal 2"]')).toBeVisible();
  await expect.poll(() => textoDoTerminal(page), { timeout: 15_000 }).not.toMatch(/marca-do-primeiro/);

  await page.locator('[data-terminal-item="Terminal 1"]').click();
  // A regressão que a spec 008 já viveu: alternar não pode remontar.
  await expect.poll(() => textoDoTerminal(page)).toMatch(/marca-do-primeiro/);
});

test('esconder o painel não mata o terminal', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await expect.poll(() => textoDoTerminal(page), { timeout: 15_000 }).toMatch(/\$/);

  await page.locator('[data-terminal]:visible').click();
  await page.keyboard.type('sobrevive-ao-esconder');
  await expect.poll(() => textoDoTerminal(page)).toMatch(/sobrevive-ao-esconder/);

  await page.keyboard.press('Control+j');
  await expect(painel(page)).toBeHidden();
  await page.keyboard.press('Control+j');

  // Esconder é esconder, não fechar (AC-4).
  await expect.poll(() => textoDoTerminal(page)).toMatch(/sobrevive-ao-esconder/);
});

test('fechar o terminal ativo tira ele da lista', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await page.getByRole('button', { name: 'Novo terminal' }).click();
  await expect(page.locator('[data-terminal-item="Terminal 2"]')).toBeVisible();

  await page.getByRole('button', { name: 'Fechar terminal' }).click();
  await expect(page.locator('[data-terminal-item="Terminal 2"]')).toHaveCount(0);
  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toBeVisible();

  await page.getByRole('button', { name: 'Fechar terminal' }).click();
  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toHaveCount(0);
});

test('um erro de execução vira problema, com contagem na aba', async ({ page }) => {
  await expect(page.locator('[data-contagem-problemas]')).toHaveCount(0);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await editor(page).locator('.monaco-editor').waitFor();
  await editor(page).click();
  await page.keyboard.insertText('throw new Error("erro-de-proposito");');

  await menu(page, 'Run');
  await page.getByRole('menuitem', { name: 'Run File' }).click();

  await expect(page.locator('[data-contagem-problemas]')).toHaveText('1', { timeout: 15_000 });
  await abaDoPainel(page, 'problems').click();
  await expect(page.locator('[data-problema]')).toContainText('erro-de-proposito');

  // Limpar zera a contagem.
  await page.getByRole('button', { name: 'Limpar problemas' }).click();
  await expect(page.locator('[data-contagem-problemas]')).toHaveCount(0);
});

test('a saída pode ser aberta no editor', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await editor(page).locator('.monaco-editor').waitFor();
  await editor(page).click();
  await page.keyboard.insertText('console.log("vai-para-o-editor");');

  await menu(page, 'Run');
  await page.getByRole('menuitem', { name: 'Run File' }).click();
  await expect(saida(page)).toContainText('vai-para-o-editor', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Abrir no editor' }).click();
  await expect(page.locator('[data-tab="output.log"]')).toBeVisible();
});
