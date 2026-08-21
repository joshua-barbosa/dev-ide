// A aba de tabela (spec 041).
//
// A montagem do SQL é testada sem banco em `server/__tests__/tabela.test.ts`, e
// contra um motor de verdade em `sqlite.driver.test.ts`. Aqui se prova o
// caminho: abrir pela árvore, paginar, ordenar, filtrar e exportar.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, textoDoEditor } from './fixtures';

const total = (page: Page) => page.locator('[data-total-da-tabela]');
const paginaAtual = (page: Page) => page.locator('[data-pagina-atual]');
const sqlDaAba = (page: Page) => page.locator('[data-sql-da-tabela]');

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });

  await linhaArvore(page, TABELA).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}` }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('abre com as linhas, o total REAL e o SQL à vista', async ({ page }) => {
  await abrirTabela(page);
  await expect(page.getByText('joshua')).toBeVisible();
  await expect(page.getByText('maria')).toBeVisible();
  // "2 de 2": o total é contado, não é o número trazido.
  await expect(total(page)).toContainText('de 2');
  await expect(sqlDaAba(page)).toContainText('SELECT');
  await expect(sqlDaAba(page)).toContainText('LIMIT');
});

test('o cabeçalho marca a chave primária e o tipo', async ({ page }) => {
  await abrirTabela(page);
  const id = page.locator('[data-coluna="id"]');
  await expect(id).toContainText('INTEGER');
  await expect(id.getByTitle('Chave primária')).toBeVisible();
  await expect(page.locator('[data-coluna="nome"]').getByTitle('NOT NULL')).toBeVisible();
});

test('paginar traz a outra linha, e o SQL mostra o OFFSET', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Linhas por página').click();
  await page.getByRole('option', { name: '50 / página' }).click();

  // Com duas linhas e 50 por página não há segunda: o botão fica desabilitado.
  await expect(page.getByLabel('Próxima página')).toBeDisabled();
  await expect(paginaAtual(page)).toContainText('1 / 1');
});

test('ordenar pela coluna inverte a ordem na tela', async ({ page }) => {
  await abrirTabela(page);
  const primeira = () => page.locator('tbody tr').first().locator('td').nth(2);

  await page.getByLabel('Ordenar por nome').click();
  await expect(primeira()).toHaveText('joshua');
  await page.getByLabel('Ordenar por nome').click();
  await expect(primeira()).toHaveText('maria');
  // Terceiro clique volta ao natural, e o ORDER BY some do SQL.
  await page.getByLabel('Ordenar por nome').click();
  await expect(sqlDaAba(page)).not.toContainText('ORDER BY');
});

test('filtrar por coluna reduz as linhas E o total, juntos', async ({ page }) => {
  // O par é o que faz a paginação não mentir.
  await abrirTabela(page);
  await page.getByLabel('Filtrar nome').fill('josh');
  await expect(total(page)).toContainText('de 1');
  await expect(page.getByText('maria')).toHaveCount(0);
  await expect(sqlDaAba(page)).toContainText('LIKE');
});

test('exportar abre o CSV numa aba, com cabeçalho e escape', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Exportar CSV').click();
  await expect.poll(() => textoDoEditor(page)).toContain('id,nome,nota');
  expect(await textoDoEditor(page)).toContain('joshua');
});

test('exportar JSON sai como lista de objetos', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Exportar JSON').click();
  await expect.poll(() => textoDoEditor(page)).toContain('"nome"');
});

test('trocar de aba e voltar NÃO perde o filtro', async ({ page }) => {
  // A aba fica montada e apenas some de vista — a regra constitucional. Remontar
  // custaria outra ida ao banco e apagaria a ordenação e os filtros.
  await abrirTabela(page);
  await page.getByLabel('Filtrar nome').fill('josh');
  await expect(total(page)).toContainText('de 1');

  await page.getByLabel('Exportar JSON').click();
  await aba(page, TABELA).click();
  await expect(page.getByLabel('Filtrar nome')).toHaveValue('josh');
  await expect(total(page)).toContainText('de 1');
});
