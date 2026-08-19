// Dividir terminal (spec 021).
//
// O backlog previa que este item ficaria "quase de graça depois do I15 — é o
// mesmo mecanismo de grupos". Ficou parecido, não igual: o editor divide por
// GRUPO (cada lado com sua barra de abas), e o terminal divide por PAR (a lista
// lateral continua uma só, com os panes recuados dentro do item).
import { expect, test, type Page } from '@playwright/test';
import { menu } from './fixtures';

const paneis = (page: Page) => page.locator('[data-pane-terminal]:visible');

async function novoTerminal(page: Page): Promise<void> {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
}

async function dividir(page: Page): Promise<void> {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'Split Terminal' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Split Terminal deixou de ser promessa', async ({ page }) => {
  await menu(page, 'Terminal');
  await expect(page.getByRole('menuitem', { name: 'Split Terminal' })).toBeEnabled();
});

test('dividir mostra dois terminais lado a lado', async ({ page }) => {
  await novoTerminal(page);
  await expect(paneis(page)).toHaveCount(1);

  await dividir(page);
  await expect(paneis(page)).toHaveCount(2);

  // Os dois são do mesmo par, e a lista lateral mostra os dois.
  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toBeVisible();
  await expect(page.locator('[data-terminal-item="Terminal 2"]')).toBeVisible();
});

test('um terminal NOVO não divide — ele fica sozinho', async ({ page }) => {
  await novoTerminal(page);
  await dividir(page);
  await expect(paneis(page)).toHaveCount(2);

  await novoTerminal(page);
  // O terceiro é de outro par: sozinho na tela.
  await expect(paneis(page)).toHaveCount(1);
});

test('voltar ao par traz os dois panes de volta', async ({ page }) => {
  await novoTerminal(page);
  await dividir(page);
  await novoTerminal(page);
  await expect(paneis(page)).toHaveCount(1);

  await page.locator('[data-terminal-item="Terminal 1"]').click();
  await expect(paneis(page)).toHaveCount(2);
});

test('os dois panes são processos DIFERENTES', async ({ page }) => {
  await novoTerminal(page);
  const primeiro = page.locator('[data-pane-terminal="Terminal 1"]');
  await expect(primeiro).toContainText(/\$|%|#/, { timeout: 15_000 });
  await primeiro.click();
  await page.keyboard.type('so-no-primeiro');
  await expect(primeiro).toContainText('so-no-primeiro');

  await dividir(page);
  const segundo = page.locator('[data-pane-terminal="Terminal 2"]');
  await expect(segundo).toContainText(/\$|%|#/, { timeout: 15_000 });

  // Cada pane tem o próprio PTY: o que foi digitado num não aparece no outro.
  await expect(segundo).not.toContainText('so-no-primeiro');
  await expect(primeiro).toContainText('so-no-primeiro');
});

test('fechar um pane deixa o outro vivo', async ({ page }) => {
  await novoTerminal(page);
  await dividir(page);
  await expect(paneis(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Fechar terminal' }).click();

  await expect(paneis(page)).toHaveCount(1);
  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toBeVisible();
});

test('dá para dividir mais de uma vez, até o teto de quatro', async ({ page }) => {
  // A spec 021 parou em dois por decisão de interface. Medido depois: quatro
  // panes numa janela normal dão uns 45 caracteres cada — estreito e legível.
  await novoTerminal(page);
  await dividir(page);
  await dividir(page);
  await expect(paneis(page)).toHaveCount(3);

  await dividir(page);
  await expect(paneis(page)).toHaveCount(4);

  // No teto, o item do menu fica cinza, como o Split Editor já faz.
  await menu(page, 'Terminal');
  await expect(page.getByRole('menuitem', { name: 'Split Terminal' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(paneis(page)).toHaveCount(4);
});

test('o teto é por par: um novo terminal volta a poder dividir', async ({ page }) => {
  await novoTerminal(page);
  for (let i = 0; i < 3; i += 1) await dividir(page);
  await expect(paneis(page)).toHaveCount(4);

  await novoTerminal(page);
  await expect(paneis(page)).toHaveCount(1);
  await menu(page, 'Terminal');
  await expect(page.getByRole('menuitem', { name: 'Split Terminal' })).toBeEnabled();
  await page.keyboard.press('Escape');
});
