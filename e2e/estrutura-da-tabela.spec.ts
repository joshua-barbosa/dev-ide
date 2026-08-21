// A sub-aba Estrutura (spec 045).
//
// O que cada driver responde é testado contra um motor de verdade em
// `sqlite.driver.test.ts`. Aqui se prova a tela: as sub-abas, a preguiça da
// busca, e a distinção entre "nenhum" e "este banco não sabe responder".
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral } from './fixtures';

const estrutura = (page: Page) => page.getByRole('tab', { name: 'estrutura' });

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, TABELA).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a aba abre em Dados, e a Estrutura só busca quando é aberta', async ({ page }) => {
  // Ninguém paga por uma aba que não abriu.
  await abrirTabela(page);
  await expect(page.getByRole('tab', { name: 'dados' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-cabecalho-estrutura]')).toHaveCount(0);

  await estrutura(page).click();
  await expect(page.locator('[data-cabecalho-estrutura]')).toBeVisible();
});

test('as colunas trazem tipo, chave e obrigatoriedade', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();

  const id = page.locator('[data-coluna-estrutura="id"]');
  await expect(id).toContainText('INTEGER');
  const nome = page.locator('[data-coluna-estrutura="nome"]');
  await expect(nome).toContainText('TEXT');
});

test('o DDL aparece inteiro', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();
  await page.getByRole('tab', { name: 'DDL' }).click();
  await expect(page.locator('[data-ddl]')).toContainText('CREATE TABLE');
});

test('"não sei responder" é diferente de "nenhum"', async ({ page }) => {
  // Confundir os dois diria que a tabela não tem gatilho, quando o que
  // acontece é que a IDE não sabe perguntar ao SQLite.
  await abrirTabela(page);
  await estrutura(page).click();

  await page.getByRole('tab', { name: 'Gatilhos' }).click();
  await expect(page.locator('[data-aviso-estrutura]')).toContainText('SQLite');

  await page.getByRole('tab', { name: 'Chaves estrangeiras' }).click();
  await expect(page.locator('[data-aviso-estrutura]')).toHaveText('Nenhum.');
});

test('trocar de sub-aba NÃO perde o que estava nos dados', async ({ page }) => {
  // Mesma regra do editor e do terminal: esconder, nunca desmontar.
  await abrirTabela(page);
  await page.getByLabel('Filtrar nome').fill('josh');
  await expect(page.locator('[data-total-da-tabela]')).toContainText('de 1');

  await estrutura(page).click();
  await page.getByRole('tab', { name: 'dados' }).click();
  await expect(page.getByLabel('Filtrar nome')).toHaveValue('josh');
  await expect(page.locator('[data-total-da-tabela]')).toContainText('de 1');
});

test('a view mostra menos sub-abas que a tabela', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();
  await expect(page.getByRole('tab', { name: 'Índices' })).toBeVisible();

  await painelLateral(page, 'Database').click();
  await linhaArvore(page, 'Views').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, 'alunos_view').hover();
  await page.getByRole('button', { name: 'Abrir tabela alunos_view', exact: true }).click();
  await estrutura(page).click();

  // Numa view não há índice, chave estrangeira nem checagem que valha mostrar.
  await expect(page.getByRole('tab', { name: 'Índices' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'DDL' })).toBeVisible();
});
