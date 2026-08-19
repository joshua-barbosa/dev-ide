// As ações do cabeçalho da árvore (spec 035).
//
// São as quatro do VS Code, na ordem dele: novo arquivo, nova pasta,
// recarregar e recolher tudo. E o que NÃO fica aqui: abrir pasta, que mora em
// File → Open Folder.
import { expect, test } from '@playwright/test';
import { entradaRapida, linhaArvore, menu } from './fixtures';

const acao = (page: import('@playwright/test').Page, nome: string) =>
  page.getByRole('button', { name: nome, exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('as quatro ações estão no cabeçalho, e abrir pasta NÃO está', async ({ page }) => {
  for (const nome of ['Novo arquivo', 'Nova pasta', 'Recarregar', 'Recolher tudo']) {
    await expect(acao(page, nome)).toBeVisible();
  }
  // Duplicar o comando em dois lugares só faz a barra parecer cheia.
  await expect(acao(page, 'Abrir pasta…')).toHaveCount(0);

  await menu(page, 'File');
  await expect(page.getByRole('menuitem', { name: 'Open Folder…' })).toBeEnabled();
});

test('novo arquivo cria na pasta aberta e já o abre', async ({ page }) => {
  await acao(page, 'Novo arquivo').click();
  await entradaRapida(page).fill('do-cabecalho.txt');
  await page.keyboard.press('Enter');

  await expect(linhaArvore(page, 'do-cabecalho.txt')).toBeVisible();
  await expect(page.locator('[data-tab="do-cabecalho.txt"]')).toBeVisible();
});

test('novo arquivo aceita caminho, criando as pastas do meio', async ({ page }) => {
  await acao(page, 'Novo arquivo').click();
  await entradaRapida(page).fill('nova/funda/arquivo.ts');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-tab="arquivo.ts"]')).toBeVisible();
  await linhaArvore(page, 'nova').click();
  await linhaArvore(page, 'funda').click();
  await expect(linhaArvore(page, 'arquivo.ts')).toBeVisible();
});

test('nova pasta aparece na árvore, vazia', async ({ page }) => {
  await acao(page, 'Nova pasta').click();
  await entradaRapida(page).fill('pasta-nova');
  await page.keyboard.press('Enter');

  await expect(linhaArvore(page, 'pasta-nova')).toBeVisible();
});

test('nome repetido é recusado, mantendo o que foi digitado', async ({ page }) => {
  await acao(page, 'Nova pasta').click();
  await entradaRapida(page).fill('repetida');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, 'repetida')).toBeVisible();

  await acao(page, 'Nova pasta').click();
  await entradaRapida(page).fill('repetida');
  await page.keyboard.press('Enter');

  await expect(page.getByText(/já existe/)).toBeVisible();
  await expect(entradaRapida(page)).toHaveValue('repetida');
});

test('recolher tudo fecha as pastas abertas', async ({ page }) => {
  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();

  await acao(page, 'Recolher tudo').click();
  await expect(linhaArvore(page, 'dentro.txt')).toHaveCount(0);
  await expect(linhaArvore(page, 'sub')).toBeVisible();
});

test('recarregar traz o que apareceu no disco por fora', async ({ page }) => {
  // A árvore ainda não vigia o disco; este botão é o que fecha essa lacuna.
  await expect(linhaArvore(page, 'de-fora.txt')).toHaveCount(0);

  await page.evaluate(async () => {
    await fetch('/api/workspace/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'de-fora.txt', content: 'oi' }),
    });
  });

  await acao(page, 'Recarregar').click();
  await expect(linhaArvore(page, 'de-fora.txt')).toBeVisible();
});
