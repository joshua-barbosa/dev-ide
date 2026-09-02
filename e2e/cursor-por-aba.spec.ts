// Cada aba guarda o SEU cursor — e os seus cursores (defeito de 02/09/2026).
//
// Ele reproduziu: *"ele perde o cursor quando eu clico na aba… e digo mais,
// cada aba tem a sua posição de cursor e multi-cursor"*.
//
// A causa era o `ViewState` da IDE guardar UMA seleção: `getSelection()` devolve
// a primária e `setSelection()` colapsa o resto. Trocar de aba salvava um cursor
// e restaurava um cursor.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, editor, esperarIdePronta } from './fixtures';

const cursores = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('.monaco-editor .cursor').length);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o MULTI-CURSOR sobrevive à troca de aba', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+Alt+i');

  const antes = await cursores(page);
  expect(antes).toBeGreaterThan(1);

  await abrirArquivo(page, 'consulta.sql');
  await page.locator('[data-tab="utils.ts"]').click();

  await expect.poll(() => cursores(page)).toBe(antes);
});

test('cada aba guarda os SEUS cursores, e não os da vizinha', async ({ page }) => {
  // Um cursor por linha num arquivo, um cursor só no outro. Voltar em cada uma
  // tem de devolver o que era dela.
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+Alt+i');
  const muitos = await cursores(page);

  await abrirArquivo(page, 'consulta.sql');
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await expect.poll(() => cursores(page)).toBe(1);

  await page.locator('[data-tab="utils.ts"]').click();
  await expect.poll(() => cursores(page)).toBe(muitos);

  await page.locator('[data-tab="consulta.sql"]').click();
  await expect.poll(() => cursores(page)).toBe(1);
});

test('a POSIÇÃO de um cursor só também volta', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  const posicao = page.getByText(/^Ln \d+, Col \d+$/);
  const antes = await posicao.textContent();

  await abrirArquivo(page, 'consulta.sql');
  await page.locator('[data-tab="utils.ts"]').click();

  await expect.poll(() => posicao.textContent()).toBe(antes);
});
