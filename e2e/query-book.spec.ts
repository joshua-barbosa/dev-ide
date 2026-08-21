// O Query Book (spec 048).
//
// O formato do arquivo é testado sem navegador em `shared/__tests__/caderno.test.ts`.
// Aqui se prova a superfície: blocos, markdown renderizado, rodar um e rodar
// todos, e — o que mais importa num caderno — que `Ctrl+S` grava.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import {
  aba, destrancarCofre, entradaRapida, esperarIdePronta, expandir, linhaArvore, painelLateral,
} from './fixtures';

const bloco = (page: Page, i: number) => page.locator('[data-bloco]').nth(i);

async function novoCaderno(page: Page, nome: string): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');

  await linhaArvore(page, 'Query').hover();
  await page.getByRole('button', { name: 'Nova query' }).click();
  await entradaRapida(page).fill(`${nome}.sqlbook`);
  await page.keyboard.press('Enter');
  await expect(aba(page, `${nome}.sqlbook`)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('um .sqlbook abre como CADERNO, e não como texto', async ({ page }) => {
  await novoCaderno(page, 'novo');
  await expect(page.getByText('Caderno vazio.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Code' })).toBeVisible();
});

test('acrescentar blocos e contar', async ({ page }) => {
  await novoCaderno(page, 'contagem');
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('button', { name: 'Add Markdown' }).click();

  await expect(page.locator('[data-bloco]')).toHaveCount(2);
  await expect(bloco(page, 0)).toHaveAttribute('data-tipo', 'sql');
  await expect(bloco(page, 1)).toHaveAttribute('data-tipo', 'markdown');
});

test('o bloco de markdown alterna entre editar e renderizado', async ({ page }) => {
  await novoCaderno(page, 'texto');
  await page.getByRole('button', { name: 'Add Markdown' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('# Chamado 64158');

  await page.getByRole('button', { name: 'Ver renderizado' }).click();
  await expect(page.locator('[data-markdown-preview] h1')).toHaveText('Chamado 64158');
});

test('rodar um bloco de SQL abre o resultado', async ({ page }) => {
  await novoCaderno(page, 'rodar');
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill("SELECT 'do-caderno' AS marca");
  await page.getByRole('button', { name: '▷ Run' }).click();

  await expect(page.getByRole('cell', { name: 'do-caderno' })).toBeVisible();
});

test('Run All roda os blocos de SQL e PULA o markdown', async ({ page }) => {
  await novoCaderno(page, 'tudo');
  await page.getByRole('button', { name: 'Add Markdown' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('## explicação');
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 2/ }).fill("SELECT 'um' AS q");
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 3/ }).fill("SELECT 'dois' AS q");

  await page.getByRole('button', { name: 'Run All' }).click();
  // `+Tab` por bloco: os dois resultados convivem, e o markdown não virou aba.
  await expect(aba(page, 'Resultado')).toHaveCount(2);
});

test('Run All PARA no primeiro erro', async ({ page }) => {
  // Um caderno é uma sequência: seguir depois de falhar daria resultados que
  // não querem dizer nada.
  await novoCaderno(page, 'erro');
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('SELECT * FROM nao_existe_mesmo');
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 2/ }).fill("SELECT 'nao-devia-rodar' AS q");

  await page.getByRole('button', { name: 'Run All' }).click();
  await expect(page.locator('[data-erro-caderno]')).toContainText('Parou no bloco');
  await expect(page.getByRole('cell', { name: 'nao-devia-rodar' })).toHaveCount(0);
});

test('Ctrl+S grava o caderno, e ele volta igual depois do F5', async ({ page }) => {
  await novoCaderno(page, 'salvo');
  await page.getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('SELECT 42');
  await expect(aba(page, 'salvo.sqlbook')).toContainText('●');

  await page.keyboard.press('Control+s');
  await expect(aba(page, 'salvo.sqlbook')).not.toContainText('●');

  await page.reload();
  await esperarIdePronta(page);
  await expect(page.getByRole('textbox', { name: /Bloco 1/ })).toHaveValue('SELECT 42');
});
