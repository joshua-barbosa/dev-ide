// Voltar para arquivo fechado (T011) e guardar o lugar (T036) — spec 073.
//
// Os dois itens são a mesma queixa dita de dois jeitos: **a IDE perdia o lugar
// onde eu estava.** Um perdia ao fechar a aba, o outro ao recarregar a página.
import { expect, test, type Page } from '@playwright/test';
import {
  abrirArquivo, confirmar, cursorDoEditor, editor, esperarEditorPronto, esperarIdePronta, menu,
} from './fixtures';

/**
 * Espera o editor aparecer SEM clicar nele.
 *
 * `esperarEditorPronto` termina com um clique — e clique move o cursor, que é
 * exatamente o que estes testes querem conferir. Gastei uma hora atrás de um
 * defeito que era isto.
 */
async function editorAVista(page: Page): Promise<void> {
  await editor(page).locator('.monaco-editor').waitFor();
  await editor(page).locator('textarea').waitFor({ state: 'attached' });
}

async function voltar(page: Page): Promise<void> {
  await menu(page, 'Go');
  await page.getByRole('menuitem', { name: /^Back/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Back reabre o arquivo que foi FECHADO (T011)', async ({ page }) => {
  await abrirArquivo(page, 'lib.ts');
  await esperarEditorPronto(page);
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);

  // Fecha o que ficou para trás. Antes do T011 a posição dele era pulada em
  // silêncio, e `Back` levava a qualquer outro lugar.
  await page.locator('[data-tab="lib.ts"]').getByRole('button', { name: 'Fechar lib.ts' }).click();
  await expect(page.locator('[data-tab="lib.ts"]')).toHaveCount(0);

  await voltar(page);
  await expect(page.locator('[data-tab="lib.ts"]')).toBeVisible();
});

test('Back numa aba SEM TÍTULO continua pulando — não há o que reabrir', async ({ page }) => {
  await abrirArquivo(page, 'lib.ts');
  await esperarEditorPronto(page);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^New Text File/ }).click();
  await expect(page.locator('[data-tab^="untitled-"]')).toBeVisible();

  const semTitulo = page.locator('[data-tab^="untitled-"]').first();
  const titulo = (await semTitulo.getAttribute('data-tab')) ?? '';
  await semTitulo.getByRole('button', { name: `Fechar ${titulo}` }).click();
  // Aba sem título nasce suja — conteúdo que não está em disco é exatamente o
  // que a marca significa —, então fechar pergunta.
  await confirmar(page, true);
  await expect(semTitulo).toHaveCount(0);

  await voltar(page);
  // Nada quebrado, e o editor segue mostrando um arquivo de verdade.
  await expect(page.locator('[data-tab="lib.ts"]')).toBeVisible();
});

test('o cursor volta onde estava depois do F5 (T036)', async ({ page }) => {
  await abrirArquivo(page, 'usa-lib.ts');
  await esperarEditorPronto(page);

  await editor(page).click();
  await page.keyboard.press('Control+End');
  const antes = await cursorDoEditor(page);
  expect(antes).not.toBe('Ln 1, Col 1');

  await page.reload();
  await esperarIdePronta(page);
  await editorAVista(page);

  // Antes do T036 a aba voltava sempre na linha 1: o arquivo certo, o lugar
  // errado.
  await expect.poll(() => cursorDoEditor(page)).toBe(antes);
});

test('cada aba guarda o PRÓPRIO lugar (T036)', async ({ page }) => {
  await abrirArquivo(page, 'usa-lib.ts');
  await esperarEditorPronto(page);
  await editor(page).click();
  await page.keyboard.press('Control+End');
  const noFim = await cursorDoEditor(page);

  await abrirArquivo(page, 'lib.ts');
  await esperarEditorPronto(page);
  await editor(page).click();
  await page.keyboard.press('Control+Home');

  await page.reload();
  await esperarIdePronta(page);
  await editorAVista(page);

  // Cada aba na SUA posição, e não as duas na do último que teve foco.
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 1, Col 1');
  await page.locator('[data-tab="usa-lib.ts"]').click();
  await expect.poll(() => cursorDoEditor(page)).toBe(noFim);
});
