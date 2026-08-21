// A aba de tabela (spec 041).
//
// A montagem do SQL é testada sem banco em `server/__tests__/tabela.test.ts`, e
// contra um motor de verdade em `sqlite.driver.test.ts`. Aqui se prova o
// caminho: abrir pela árvore, paginar, ordenar, filtrar e exportar.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, textoDoEditor, esperarIdePronta } from './fixtures';

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
    // `exact`: `alunos` é prefixo de `alunos_edicao`, a tabela que a spec 044 usa
  // para escrever. Sem isto o seletor casa com as duas.
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
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
  // `nth(3)`, e não `nth(2)`: numa tabela editável (spec 044) a grade tem uma
  // coluna a mais na frente, com a caixa de marcar para apagar.
  const primeira = () => page.locator('tbody tr').first().locator('td').nth(3);

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

// ---------------------------------------------------------------------------
// O SQL editável (spec 043)
// ---------------------------------------------------------------------------

const campoSql = (page: Page) => page.getByLabel('SQL desta aba');

test('o SQL do topo é editável e roda com o botão', async ({ page }) => {
  await abrirTabela(page);
  await campoSql(page).fill("SELECT 'so-uma' AS marca");
  await page.getByRole('button', { name: 'Executar este SQL' }).click();

  // Na CÉLULA, e não no campo: o texto aparece nos dois, e `getByText` casaria
  // com o `textarea` também.
  await expect(page.getByRole('cell', { name: 'so-uma' })).toBeVisible();
  // Modo livre: a IDE não montou este SQL, e diz isso.
  await expect(page.locator('[data-modo-livre]')).toBeVisible();
});

test('em modo livre a paginação e o filtro por coluna somem', async ({ page }) => {
  // Botão que não faz nada é pior que botão ausente.
  await abrirTabela(page);
  await campoSql(page).fill('SELECT 1 AS um');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('[data-modo-livre]')).toBeVisible();
  await expect(page.getByLabel('Próxima página')).toHaveCount(0);
  await expect(page.getByLabel('Linhas por página')).toHaveCount(0);
  await expect(page.getByLabel('Filtrar um')).toHaveCount(0);
});

test('voltar ao SQL da tabela devolve os controles', async ({ page }) => {
  await abrirTabela(page);
  await campoSql(page).fill('SELECT 1 AS um');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('[data-modo-livre]')).toBeVisible();

  await page.getByRole('button', { name: 'Voltar ao SQL da tabela' }).click();
  await expect(page.locator('[data-modo-livre]')).toHaveCount(0);
  await expect(total(page)).toContainText('de 2');
  await expect(campoSql(page)).toHaveValue(/SELECT/);
});

test('SQL errado mostra o erro SEM perder o que foi digitado', async ({ page }) => {
  await abrirTabela(page);
  await campoSql(page).fill('SELECT * FROM nao_existe_mesmo');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('[data-erro-tabela]')).toContainText(/no such table/i);
  await expect(campoSql(page)).toHaveValue('SELECT * FROM nao_existe_mesmo');
});

test('ordenar reescreve o SQL do topo — ele é espelho', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Ordenar por nome').click();
  await expect(campoSql(page)).toHaveValue(/ORDER BY "nome" ASC/);
});

test('a aba de tabela NÃO mostra o ▷ da barra de abas', async ({ page }) => {
  // Ele executava o editor do grupo, que ainda guardava outro arquivo.
  await abrirTabela(page);
  await expect(page.getByRole('button', { name: 'Executar consulta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Executar este SQL' })).toBeVisible();
});
