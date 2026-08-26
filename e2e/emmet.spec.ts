// Emmet (spec 022).
//
// `div.foo>ul>li*3` vira HTML. O motor é o oficial, embrulhado para o Monaco
// pelo `emmet-monaco-es`, que o registra como **provedor de conclusão** — a
// expansão aparece na lista de sugestões e é aceita com Tab.
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, esperarEditorPronto, menu, textoDoEditor, esperarIdePronta } from './fixtures';

/**
 * Espera a lista de sugestões — e PEDE, se ela não vier sozinha.
 *
 * O gatilho automático do Monaco depende de temporizador, e sob carga (a suíte
 * inteira rodando) ele passa dos 10 segundos. Este teste ficou instável por
 * isso: falhou duas vezes na suíte completa e passou sempre sozinho.
 *
 * `Ctrl+Espaço` abre a mesma lista, do mesmo provedor. O que se quer provar
 * aqui é que o Emmet EXPANDE na ilha de HTML — não que o Monaco decidiu abrir
 * a lista sem ninguém pedir.
 */
async function esperarSugestoes(page: Page): Promise<void> {
  const lista = page.locator('.suggest-widget');
  if (await lista.isVisible().catch(() => false)) return;
  try {
    await expect(lista).toBeVisible({ timeout: 4_000 });
  } catch {
    await page.keyboard.press('Control+Space');
    await expect(lista).toBeVisible({ timeout: 10_000 });
  }
}


/** Cria um arquivo sem título e escolhe a linguagem. */
async function arquivoEm(
  page: import('@playwright/test').Page,
  linguagem: string
): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);

  await page.getByRole('button', { name: 'Selecionar linguagem' }).click();
  await entradaRapida(page).fill(linguagem);
  await page.keyboard.press('Enter');
  await expect(page.locator('footer')).toContainText(linguagem);
}

const arquivoHtml = (page: import('@playwright/test').Page) => arquivoEm(page, 'HTML');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
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

  await esperarSugestoes(page);
  await page.keyboard.press('Tab');

  await expect.poll(() => textoDoEditor(page)).toMatch(/<ul>/);
  await expect.poll(() => textoDoEditor(page)).toMatch(/<li><\/li>/);
});

test('multiplicação e classe: div.card*2', async ({ page }) => {
  await arquivoHtml(page);
  await page.locator('[data-grupo-focado="true"] [data-editor]').click();
  await page.keyboard.type('div.card*2');

  await esperarSugestoes(page);
  await page.keyboard.press('Tab');

  // `poll`, e não leitura direta: o Monaco aplica a expansão fora do turno em
  // que a tecla é despachada. Ler na hora dava `undefined` de vez em quando — e
  // falha intermitente ensina a ignorar vermelho.
  await expect
    .poll(async () => (await textoDoEditor(page)).match(/class="card"/g)?.length ?? 0)
    .toBe(2);
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

// ---------------------------------------------------------------------------
// PHP (spec 033)
// ---------------------------------------------------------------------------

test('em PHP, a abreviação expande na ILHA de HTML', async ({ page }) => {
  await arquivoEm(page, 'PHP');
  await page.locator('[data-grupo-focado="true"] [data-editor]').click();
  await page.keyboard.type('<?php $x = 1; ?>\n');
  await page.keyboard.type('ul>li*2');

  await esperarSugestoes(page);
  await page.keyboard.press('Tab');

  await expect
    .poll(async () => (await textoDoEditor(page)).match(/<li><\/li>/g)?.length ?? 0)
    .toBe(2);
});

test('em PHP, DENTRO do <?php ?> o Emmet não se mete', async ({ page }) => {
  // Era o motivo de o item parecer grande: seria preciso achar as ilhas de HTML
  // dentro do arquivo. Quem já faz isso é a biblioteca, olhando os tokens do
  // Monaco — dentro do bloco eles são de PHP, e não de HTML.
  await arquivoEm(page, 'PHP');
  await page.locator('[data-grupo-focado="true"] [data-editor]').click();
  await page.keyboard.type('<?php\n');
  await page.keyboard.type('ul>li');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');

  await expect.poll(() => textoDoEditor(page)).toMatch(/ul>li/);
  await expect.poll(() => textoDoEditor(page)).not.toMatch(/<li>/);
});
