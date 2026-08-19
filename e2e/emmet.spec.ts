// Emmet (spec 022).
//
// `div.foo>ul>li*3` vira HTML. O motor é o oficial, embrulhado para o Monaco
// pelo `emmet-monaco-es`, que o registra como **provedor de conclusão** — a
// expansão aparece na lista de sugestões e é aceita com Tab.
import { expect, test } from '@playwright/test';
import { entradaRapida, esperarEditorPronto, menu, textoDoEditor } from './fixtures';

/** Cria um arquivo sem título e põe a linguagem em HTML. */
async function arquivoHtml(page: import('@playwright/test').Page): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);

  await page.getByRole('button', { name: 'Selecionar linguagem' }).click();
  await entradaRapida(page).fill('HTML');
  await page.keyboard.press('Enter');
  await expect(page.locator('footer')).toContainText('HTML');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Emmet deixou de ser promessa no menu Edit', async ({ page }) => {
  await menu(page, 'Edit');
  const item = page.getByRole('menuitem', { name: /Emmet/ });
  await expect(item).toBeEnabled();
  await expect(item).not.toContainText('em breve');
});

test('uma abreviação simples vira HTML', async ({ page }) => {
  await arquivoHtml(page);
  await page.locator('[data-grupo-focado="true"] [data-editor]').click();
  await page.keyboard.type('ul>li');

  await expect(page.locator('.suggest-widget')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Tab');

  await expect.poll(() => textoDoEditor(page)).toMatch(/<ul>/);
  await expect.poll(() => textoDoEditor(page)).toMatch(/<li><\/li>/);
});

test('multiplicação e classe: div.card*2', async ({ page }) => {
  await arquivoHtml(page);
  await page.locator('[data-grupo-focado="true"] [data-editor]').click();
  await page.keyboard.type('div.card*2');

  await expect(page.locator('.suggest-widget')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Tab');

  const texto = await textoDoEditor(page);
  expect(texto.match(/class="card"/g)?.length).toBe(2);
});

test('em TypeScript o Emmet NÃO se mete', async ({ page }) => {
  // É a razão de este ter sido o último item grande da fila: Emmet só serve
  // HTML, CSS e JSX, e o uso da IDE é sobretudo TS, PHP e SQL.
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.getByRole('button', { name: 'Selecionar linguagem' }).click();
  await entradaRapida(page).fill('TypeScript');
  await page.keyboard.press('Enter');

  await page.locator('[data-grupo-focado="true"] [data-editor]').click();
  await page.keyboard.type('ul>li');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');

  // Continua sendo texto, e o Tab só indentou.
  await expect.poll(() => textoDoEditor(page)).toMatch(/ul>li/);
  await expect.poll(() => textoDoEditor(page)).not.toMatch(/<ul>/);
});
