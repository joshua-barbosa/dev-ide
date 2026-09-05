// Editar pela grade também em SQL livre (T060 · spec 044).
//
// Na spec 044 eu escrevi que não dava porque "a IDE não sabe qual tabela é".
// Ela sabe em muito caso: `select * from alunos where id = 1` é inequívoco. O
// que não dá é adivinhar em JOIN, GROUP BY, subconsulta ou coluna calculada — e
// aí ela diz o motivo EXATO, em vez do genérico de antes.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA_EDITAVEL } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, TABELA_EDITAVEL).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA_EDITAVEL}`, exact: true }).click();
  await expect(aba(page, TABELA_EDITAVEL)).toBeVisible();
}

async function rodarLivre(page: Page, sql: string): Promise<void> {
  await page.locator('[data-sql-da-tabela]').fill(sql);
  await page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' }).click();
  await expect(page.locator('[data-modo-livre]')).toBeVisible();
}

/** A grade só oferece a caixa de apagar quando a edição está ligada. */
const podeEditar = (page: Page) => page.getByRole('button', { name: 'Acrescentar linha' });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('SELECT simples da MESMA tabela continua editável', async ({ page }) => {
  await abrirTabela(page);
  await rodarLivre(page, `select * from ${TABELA_EDITAVEL} where id = 1`);
  await expect(podeEditar(page)).toBeVisible();
});

test('editar uma célula em SQL livre chega ao rascunho', async ({ page }) => {
  await abrirTabela(page);
  await rodarLivre(page, `select * from ${TABELA_EDITAVEL} where id = 1`);

  // `ana` é a linha 1 de `alunos_edicao` — a tabela de escrita do fixture.
  const celula = page.locator('[data-grade] tbody td', { hasText: 'ana' }).first();
  await celula.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('editada em sql livre');
  await page.keyboard.press('Enter');

  // Quem grava continua sendo a barra de rascunho, com o SQL à vista.
  await expect(page.getByRole('button', { name: /Gravar/i })).toBeVisible();
});

test('com JOIN a edição some, e o motivo é EXATO', async ({ page }) => {
  await abrirTabela(page);
  await rodarLivre(page, `select a.* from ${TABELA_EDITAVEL} a join ${TABELA_EDITAVEL} b on a.id = b.id`);
  await expect(podeEditar(page)).toHaveCount(0);
  // Antes o texto era sempre "a IDE não sabe qual tabela é". Agora diz o quê.
  const celula = page.locator('[data-grade] tbody td').nth(2);
  await expect(celula).toHaveAttribute('title', /junta mais de uma tabela/);
});

test('lendo OUTRA tabela, a edição some — e diz qual', async ({ page }) => {
  await abrirTabela(page);
  await rodarLivre(page, 'select * from alunos');
  await expect(podeEditar(page)).toHaveCount(0);
  const celula = page.locator('[data-grade] tbody td').nth(2);
  await expect(celula).toHaveAttribute('title', /lê `alunos`/);
});

test('coluna calculada tira a edição: o resultado não é a tabela', async ({ page }) => {
  await abrirTabela(page);
  await rodarLivre(page, `select count(*) as total from ${TABELA_EDITAVEL}`);
  await expect(podeEditar(page)).toHaveCount(0);
});
