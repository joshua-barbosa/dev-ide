// A árvore carrega um nível por vez (spec 034).
//
// O que mudou não é aparência: é quem paga o custo. A versão anterior lia a
// pasta INTEIRA de uma vez, com teto global de nós — e uma `.venv` gastava o
// teto sozinha, deixando a árvore truncada em silêncio. A saída não foi
// esconder mais pastas: foi parar de descer sem ser pedido.
import { expect, test } from '@playwright/test';
import { entradaRapida, esperarEditorPronto, linhaArvore, menu, painelLateral } from './fixtures';

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

test('recarregar a árvore NÃO esvazia as pastas já abertas', async ({ page }) => {
  // `recarregar()` devolve só o primeiro nível — é o que a spec 034 fez dele.
  // Criar um arquivo chama `recarregar()`, e sem cuidado toda pasta aberta
  // perde os filhos e some da tela sem ninguém ter fechado nada.
  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText('x');
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await entradaRapida(page).fill('recarrega.txt');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, 'recarrega.txt')).toBeVisible();

  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();
});

// ---------------------------------------------------------------------------
// O que o .gitignore ignora (spec 036)
// ---------------------------------------------------------------------------

test('o ignorado aparece em CINZA, e não escondido', async ({ page }) => {
  const ignorado = linhaArvore(page, 'ignorado.txt');
  const normal = linhaArvore(page, 'utils.ts');

  await expect(ignorado).toBeVisible();
  await expect(normal).toBeVisible();

  // O cinza tem um significado exato: a IDE não indexa aquilo.
  await expect(ignorado).toHaveCSS('font-style', 'italic');
  await expect(normal).toHaveCSS('font-style', 'normal');
  await expect(ignorado).toHaveAttribute('title', /ignorado pelo \.gitignore/);
});

test('a pasta de dependência também vem marcada', async ({ page }) => {
  await expect(linhaArvore(page, 'node_modules')).toHaveCSS('font-style', 'italic');
  await expect(linhaArvore(page, 'sub')).toHaveCSS('font-style', 'normal');
});

test('o ignorado continua abrindo normalmente', async ({ page }) => {
  // Cinza é aviso, não bloqueio.
  await linhaArvore(page, 'ignorado.txt').click();
  await expect(page.locator('[data-tab="ignorado.txt"]')).toBeVisible();
});

test('metadado de controle de versão NÃO aparece', async ({ page }) => {
  await expect(linhaArvore(page, '.git')).toHaveCount(0);
});
