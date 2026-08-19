// Preview de markdown (spec 024).
//
// O botão mostra o markdown renderizado no lugar do texto do arquivo. O que
// mais importa aqui não é a aparência: é que o conteúdo do documento **nunca**
// chega ao DOM como marcação. As cargas de ataque em si são testadas sem
// navegador, em `shared/__tests__/markdown.test.ts`; aqui se prova o caminho.
import { expect, test, type Page } from '@playwright/test';
import { editor, esperarEditorPronto, entradaRapida, menu } from './fixtures';

const preview = (page: Page) => page.locator('[data-markdown-preview]');
// `exact`: o botão de fechar aba passou a se chamar "Fechar <arquivo>", e num
// arquivo chamado `preview-*.md` isso também contém "preview".
const botao = (page: Page) => page.getByRole('button', { name: 'Preview', exact: true });

/** Cria um `.md` na pasta aberta, com o conteúdo dado. */
async function arquivoMarkdown(page: Page, nome: string, conteudo: string): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText(conteudo);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await entradaRapida(page).fill(nome);
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-tab="${nome}"]`)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('um .md abre COMO markdown, e não como texto puro', async ({ page }) => {
  // Era o defeito por trás do pedido: a spec 010 declarou markdown só no mapa
  // do Monaco, e o mapa de extensões nunca soube.
  await arquivoMarkdown(page, 'preview-linguagem.md', '# oi');
  await expect(page.locator('footer')).toContainText('Markdown');
});

test('o botão Preview só aparece em markdown', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await expect(botao(page)).toHaveCount(0);

  await arquivoMarkdown(page, 'preview-botao.md', '# oi');
  await expect(botao(page)).toBeVisible();
});

test('o botão troca entre o texto e o renderizado', async ({ page }) => {
  await arquivoMarkdown(
    page,
    'preview-troca.md',
    '# Um título\n\nUm **negrito**.\n\n| a | b |\n|---|---|\n| 1 | 2 |'
  );

  await expect(preview(page)).toHaveCount(0);
  await botao(page).click();

  await expect(preview(page)).toBeVisible();
  await expect(preview(page).locator('h1')).toHaveText('Um título');
  await expect(preview(page).locator('strong')).toHaveText('negrito');
  await expect(preview(page).locator('table td').first()).toHaveText('1');
  // O texto do arquivo sai de vista enquanto o renderizado está à frente.
  await expect(editor(page)).toBeHidden();

  await botao(page).click();
  await expect(preview(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
});

test('o preview mostra o que está NA TELA, inclusive o não salvo', async ({ page }) => {
  await arquivoMarkdown(page, 'preview-sujo.md', '# antes');

  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n## acrescentado sem salvar');

  await botao(page).click();
  // Ler do disco mostraria a versão de antes da última tecla.
  await expect(preview(page).locator('h2')).toHaveText('acrescentado sem salvar');
});

test('HTML dentro do markdown NÃO vira elemento', async ({ page }) => {
  await arquivoMarkdown(
    page,
    'preview-seguranca.md',
    '# título\n\n<script>window.__INVADIU__ = true;</script>\n\n<img src=x onerror="window.__INVADIU__ = true">'
  );
  await botao(page).click();
  await expect(preview(page)).toBeVisible();

  const invadiu = await page.evaluate(
    () => (window as unknown as { __INVADIU__?: boolean }).__INVADIU__ === true
  );
  expect(invadiu).toBe(false);
  // Nem script nem img chegaram ao DOM.
  await expect(preview(page).locator('script')).toHaveCount(0);
  await expect(preview(page).locator('img')).toHaveCount(0);
  // E o que foi escrito continua visível, como texto.
  await expect(preview(page)).toContainText('<script>');
});

test('link com javascript: perde o href', async ({ page }) => {
  await arquivoMarkdown(page, 'preview-link.md', '[clique aqui](javascript:alert(1))');
  await botao(page).click();

  await expect(preview(page)).toContainText('clique aqui');
  await expect(preview(page).locator('a')).toHaveCount(0);
});
