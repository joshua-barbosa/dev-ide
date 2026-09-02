// Recortar, copiar, colar e desfazer no editor.
//
// Defeito relatado por ele em 02/09/2026: *"os atalhos de teclado não funcionam
// em nenhum editor ali. O CTRL + X, CTRL + C, CTRL + V; Só o SHIFT + ALT +
// ArrowDown e o CTRL + D"*.
//
// A pista estava na segunda metade da frase: os que funcionavam eram os que
// caem numa ação nomeada do Monaco; os que não funcionavam eram os que a IDE
// engolia com `preventDefault` e reimplementava com `document.execCommand`.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, editor, esperarIdePronta } from './fixtures';

const texto = (page: Page): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.view-line')]
      .map((l) => (l as HTMLElement).innerText.replace(/ /g, ' '))
      .join('\n')
  );

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Ctrl+C e Ctrl+V no editor', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+c');

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('export');

  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');

  await expect.poll(async () => (await texto(page)).split('\n').at(-1)).toContain('export');
});

test('Ctrl+X TIRA a linha, e Ctrl+Z a traz de volta', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');

  const antes = await texto(page);
  await page.keyboard.press('Control+x');
  await expect.poll(() => texto(page)).not.toBe(antes);

  await page.keyboard.press('Control+z');
  await expect.poll(() => texto(page)).toBe(antes);
});

test('a cópia com MULTI-CURSOR cola um pedaço em CADA cursor', async ({ page }) => {
  // É o que o `document.execCommand` destruía: ele devolve um texto só, e colar
  // com três cursores repetia o mesmo em todos. O Monaco guarda um pedaço por
  // cursor — e só o caminho NATIVO chega nele.
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();

  // Um arquivo previsível: três linhas, três palavras diferentes.
  await page.keyboard.press('Control+a');
  await page.keyboard.type('um\ndois\ntres');

  // Um cursor por linha, selecionando a linha inteira em cada.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+Alt+i');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+c');

  // Cola no fim de cada linha: cada cursor recebe o SEU pedaço.
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');

  await expect.poll(() => texto(page)).toBe('umum\ndoisdois\ntrestres');
});
