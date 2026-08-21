// Go Back e Go Forward (spec 016).
//
// A afirmação central: `Back` volta para onde se estava, e não uma casa por vez
// a cada tecla digitada — registrar movimento de cursor faria o comando não
// servir para nada.
import { expect, test } from '@playwright/test';
import { abrirArquivo, esperarEditorPronto, menu, esperarIdePronta } from './fixtures';

const abaAtiva = (page: import('@playwright/test').Page) =>
  page.locator('[data-tab-active="true"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Back e Forward começam cinza', async ({ page }) => {
  await menu(page, 'Go');
  await expect(page.getByRole('menuitem', { name: /^Back/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /^Forward/ })).toBeDisabled();
});

test('Back volta para a aba anterior e Forward refaz o caminho', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'consulta.sql');

  await menu(page, 'Go');
  await page.getByRole('menuitem', { name: /^Back/ }).click();
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'utils.ts');

  await menu(page, 'Go');
  await page.getByRole('menuitem', { name: /^Forward/ }).click();
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'consulta.sql');
});

test('os atalhos Alt+seta fazem o mesmo', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'utils.ts');

  await page.keyboard.press('Alt+ArrowRight');
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'consulta.sql');
});

test('digitar NÃO entra no histórico', async ({ page }) => {
  // A decisão central: `Back` é "voltar para onde eu estava", não um desfazer
  // de cursor. Se cada tecla entrasse, este Back não sairia de utils.ts.
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await esperarEditorPronto(page);
  await page.keyboard.insertText('-- muitas teclas aqui, uma por uma');

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'utils.ts');
});

test('navegar depois de voltar descarta o caminho da frente', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'utils.ts');

  // Salto novo a partir daqui: "consulta.sql" deixa de estar à frente.
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'untitled-1');

  await menu(page, 'Go');
  await expect(page.getByRole('menuitem', { name: /^Forward/ })).toBeDisabled();
});

test('Back pula aba fechada em vez de falhar', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();

  // Fecha a do meio.
  await page.locator('[data-tab="consulta.sql"]').locator('button').click();
  await expect(page.locator('[data-tab="consulta.sql"]')).toHaveCount(0);

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(abaAtiva(page)).toHaveAttribute('data-tab', 'utils.ts');
});
