// A árvore carrega um nível por vez (spec 034).
//
// O que mudou não é aparência: é quem paga o custo. A versão anterior lia a
// pasta INTEIRA de uma vez, com teto global de nós — e uma `.venv` gastava o
// teto sozinha, deixando a árvore truncada em silêncio. A saída não foi
// esconder mais pastas: foi parar de descer sem ser pedido.
import { expect, test } from '@playwright/test';
import { linhaArvore, painelLateral } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a pasta de dependência APARECE na árvore', async ({ page }) => {
  // Escondê-la era mentir sobre o projeto: num Laravel, `vendor` existe e o
  // usuário sabe. Só não se desce nela sem pedir.
  await expect(linhaArvore(page, 'node_modules')).toBeVisible();
  await expect(linhaArvore(page, 'sub')).toBeVisible();
});

test('o conteúdo de uma pasta só chega quando ela é aberta', async ({ page }) => {
  await expect(linhaArvore(page, 'dentro.txt')).toHaveCount(0);

  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();
});

test('fechar e reabrir não pede de novo — o que já veio fica', async ({ page }) => {
  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();

  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toHaveCount(0);

  const pedidos: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/files/children')) pedidos.push(r.url());
  });
  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();
  expect(pedidos).toHaveLength(0);
});

test('abrir um arquivo de dentro de uma pasta carregada funciona', async ({ page }) => {
  await linhaArvore(page, 'sub').click();
  await linhaArvore(page, 'dentro.txt').click();
  await expect(page.locator('[data-tab="dentro.txt"]')).toBeVisible();
});

test('a BUSCA não entra na pasta de dependência', async ({ page }) => {
  // O outro lado da moeda: quem mostra não filtra, quem varre filtra. O mesmo
  // termo está nos dois arquivos, e só um pode aparecer.
  await painelLateral(page, 'Search').click();
  await page.getByLabel('Pesquisar', { exact: true }).fill('ZORBAXDEPENDENCIA');

  await expect(page.locator('[data-resumo-busca]')).toHaveText('1 em 1 arquivo(s)');
  await expect(page.locator('[data-arquivo-busca="dentro.txt"]')).toBeVisible();
  await expect(page.locator('[data-arquivo-busca="dep.js"]')).toHaveCount(0);
});
