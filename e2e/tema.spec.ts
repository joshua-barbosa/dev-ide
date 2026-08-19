// Tema claro e escuro (spec 017).
//
// `workbench.theme` é estado global do servidor: cada teste devolve o escuro no
// fim, senão os testes de cor de outros arquivos falhariam por motivo que não
// mencionam.
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, menu } from './fixtures';

/** A cor de fundo do editor, resolvida pelo navegador. */
async function fundoDoEditor(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--di-bg-editor').trim()
  );
}

async function temaGravado(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/api/prefs');
    return (await r.json()).data['workbench.theme'] as string;
  });
}

async function escolherTema(page: Page, rotulo: string): Promise<void> {
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Appearance' }).click();
  await expect(entradaRapida(page)).toBeVisible();
  await page.getByRole('option', { name: rotulo }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() =>
    fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'workbench.theme': 'escuro' }),
    })
  );
});

test('Appearance abre a escolha e marca o tema atual', async ({ page }) => {
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Appearance' }).click();

  await expect(page.getByRole('option', { name: /Escuro/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Claro/ })).toBeVisible();
  // O atual vem marcado — sem isso a caixa não diz onde se está.
  await expect(page.getByRole('option', { name: /Escuro/ })).toContainText('atual');
});

test('trocar para claro repinta a IDE sem recarregar', async ({ page }) => {
  expect(await fundoDoEditor(page)).toBe('#16171c');

  await escolherTema(page, /Claro/);

  await expect.poll(() => fundoDoEditor(page)).toBe('#ffffff');
  await expect.poll(() => temaGravado(page)).toBe('claro');
});

test('o tema sobrevive a recarregar a página', async ({ page }) => {
  await escolherTema(page, /Claro/);
  await expect.poll(() => fundoDoEditor(page)).toBe('#ffffff');

  await page.reload();
  expect(await fundoDoEditor(page)).toBe('#ffffff');
});

test('trocar de tema NÃO mata o terminal aberto', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  const terminal = page.locator('[data-terminal="shell"]');
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 15_000 });

  await terminal.click();
  await page.keyboard.type('marca-antes-do-tema');
  await expect(terminal).toContainText('marca-antes-do-tema');

  await escolherTema(page, /Claro/);
  await expect.poll(() => fundoDoEditor(page)).toBe('#ffffff');

  // Repintar não é remontar: o processo e o buffer continuam.
  await expect(terminal).toContainText('marca-antes-do-tema');
});

test('tema desconhecido no config.json cai no padrão', async ({ page }) => {
  const resposta = await page.evaluate(async () => {
    const r = await fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'workbench.theme': 'solarized' }),
    });
    return (await r.json()) as { success: boolean; error: string | null };
  });

  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/escuro, claro/);
});
