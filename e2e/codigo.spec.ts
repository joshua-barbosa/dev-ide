// Navegação por código: definição, tipo e referências (spec 032).
//
// A parte que decide "onde isto foi definido" é testada sem navegador, em
// `server/__tests__/linguagem.test.ts` — inclusive o caso que separa isto de um
// `grep`, o mesmo nome em escopos diferentes. Aqui se prova o caminho: cursor,
// atalho, salto e a lista quando há mais de um lugar.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, editor, esperarEditorPronto, menu, rodape } from './fixtures';

/** Põe o cursor sobre a primeira ocorrência de um trecho da linha dada. */
async function cursorEm(page: Page, linha: number, coluna: number): Promise<void> {
  await esperarEditorPronto(page);
  await page.keyboard.press('Control+Home');
  for (let i = 1; i < linha; i += 1) await page.keyboard.press('ArrowDown');
  for (let i = 1; i < coluna; i += 1) await page.keyboard.press('ArrowRight');
  await expect(rodape(page)).toContainText(`Ln ${linha}, Col ${coluna}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('F12 atravessa para o arquivo onde a função foi definida', async ({ page }) => {
  await abrirArquivo(page, 'usa-lib.ts');
  // `export const MENSAGEM = saudar("joshua");` — o cursor vai sobre `saudar`.
  await cursorEm(page, 3, 25);

  await page.keyboard.press('F12');

  await expect(page.locator('[data-tab="lib.ts"]')).toBeVisible();
  await expect(rodape(page)).toContainText('Ln 1, Col 17');
});

test('o item do menu faz o mesmo que o atalho', async ({ page }) => {
  await abrirArquivo(page, 'usa-lib.ts');
  await cursorEm(page, 3, 25);

  await menu(page, 'Go');
  await page.getByRole('menuitem', { name: 'Go to Definition' }).click();
  await expect(page.locator('[data-tab="lib.ts"]')).toBeVisible();
});

test('as referências de um símbolo usado em dois arquivos abrem a escolha', async ({ page }) => {
  await abrirArquivo(page, 'lib.ts');
  await cursorEm(page, 1, 17); // sobre `saudar`

  await page.keyboard.press('Shift+F12');

  // Pelo NOME: a entrada rápida é um `Dialog` do MUI com um `role="dialog"`
  // próprio dentro, e o seletor sem qualificação casa os dois.
  const dialogo = page.getByRole('dialog', { name: 'Referências' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText('lib.ts');
  await expect(dialogo).toContainText('usa-lib.ts');

  // Escolher um leva até ele.
  await dialogo.getByText('usa-lib.ts:3').click();
  await expect(page.locator('[data-tab="usa-lib.ts"]')).toBeVisible();
});

test('funciona no que está na tela e ainda NÃO foi salvo', async ({ page }) => {
  await abrirArquivo(page, 'usa-lib.ts');
  await esperarEditorPronto(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nexport const OUTRA = saudar("maria");');

  // Sem salvar: o cursor vai sobre o `saudar` recém-digitado.
  await cursorEm(page, 5, 22);
  await page.keyboard.press('F12');

  await expect(page.locator('[data-tab="lib.ts"]')).toBeVisible();
});

test('numa linguagem sem suporte, a IDE DIZ que não sabe', async ({ page }) => {
  // Ficar quieto faria "não achei" e "não funciona" se parecerem.
  await abrirArquivo(page, 'consulta.sql');
  await esperarEditorPronto(page);
  await page.keyboard.press('F12');

  const dialogo = page.getByRole('dialog').first();
  await expect(dialogo).toContainText('TypeScript');
  await expect(dialogo).toContainText('JavaScript');
});
