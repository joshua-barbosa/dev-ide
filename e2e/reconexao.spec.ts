// Reconexão de terminal depois do F5 (spec 023).
//
// A afirmação central e a razão de o item existir: recarregar a página deixava
// de matar o terminal. O que se prova aqui é que o PROCESSO é o mesmo — não um
// novo com a mesma aparência.
import { expect, test, type Page } from '@playwright/test';
import { menu, esperarIdePronta } from './fixtures';

const terminal = (page: Page) => page.locator('[data-terminal="shell"]');

async function novoTerminal(page: Page): Promise<void> {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await expect(terminal(page)).toContainText(/\$|%|#/, { timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
  // Estado limpo: outro teste pode ter deixado terminal guardado.
  await page.evaluate(() => localStorage.removeItem('dev-ide.terminais'));
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => localStorage.removeItem('dev-ide.terminais'));
});

test('o terminal SOBREVIVE ao recarregar a página', async ({ page }) => {
  await novoTerminal(page);
  await terminal(page).click();

  // Uma variável de shell é a prova de que o processo é o MESMO: uma sessão
  // nova não a teria.
  await page.keyboard.type('MARCA_DA_SESSAO=vivo-desde-antes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('echo prova=$MARCA_DA_SESSAO');
  await page.keyboard.press('Enter');
  await expect(terminal(page)).toContainText('prova=vivo-desde-antes', { timeout: 15_000 });

  await page.reload();

  // A aba voltou, e a tela foi repintada com o histórico.
  await expect(terminal(page)).toBeVisible({ timeout: 15_000 });
  await expect(terminal(page)).toContainText('prova=vivo-desde-antes', { timeout: 15_000 });

  // E o processo é o mesmo: a variável continua definida.
  await terminal(page).click();
  await page.keyboard.type('echo depois=$MARCA_DA_SESSAO');
  await page.keyboard.press('Enter');
  await expect(terminal(page)).toContainText('depois=vivo-desde-antes', { timeout: 15_000 });
});

test('fechar o terminal de propósito NÃO o traz de volta', async ({ page }) => {
  await novoTerminal(page);
  await page.getByRole('button', { name: 'Fechar terminal' }).click();
  await expect(terminal(page)).toHaveCount(0);

  await page.reload();
  // Fechar é fechar. Só a queda do socket é que espera.
  await expect(terminal(page)).toHaveCount(0);
});

test('dois terminais voltam os dois', async ({ page }) => {
  await novoTerminal(page);
  await page.getByRole('button', { name: 'Novo terminal' }).click();
  await expect(page.locator('[data-terminal-item="Terminal 2"]')).toBeVisible();

  await page.reload();

  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-terminal-item="Terminal 2"]')).toBeVisible();
});
