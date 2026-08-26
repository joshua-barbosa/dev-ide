// Editar pela grade (spec 044).
//
// A montagem do SQL é testada sem banco em `server/__tests__/escrita.test.ts`, e
// a transação — com desfazer e detecção de alteração concorrente — contra um
// motor de verdade em `sqlite.driver.test.ts`.
//
// Aqui se prova o que só o navegador responde, e é o que mais importa nesta
// spec: que **nada é gravado sem o usuário ler o SQL e dizer sim**.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA_EDITAVEL } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

/**
 * Responde ao diálogo de gravação.
 *
 * O `confirmar` de `fixtures.ts` casa por uma lista de rótulos comuns, e o desta
 * spec é "Gravar" — de propósito: o botão diz o que faz.
 */
async function responderGravacao(page: Page, aceitar: boolean): Promise<void> {
  const caixa = page.getByRole('dialog');
  await expect(caixa).toContainText('UPDATE', { timeout: 10_000 }).catch(() => {});
  await caixa.getByRole('button', { name: aceitar ? 'Gravar' : /cancelar/i }).click();
}

const rascunho = (page: Page) => page.locator('[data-rascunho]');

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

/** Edita a célula `nome` da primeira linha. */
async function editarPrimeiroNome(page: Page, valor: string): Promise<void> {
  await page.locator('tbody tr').first().locator('td').nth(3).dblclick();
  await page.getByLabel('Valor da célula').fill(valor);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('editar uma célula deixa a alteração PENDENTE, sem tocar no banco', async ({ page }) => {
  await abrirTabela(page);
  await editarPrimeiroNome(page, 'editado-mas-nao-gravado');

  await expect(rascunho(page)).toContainText('1 alterada(s)');
  await expect(rascunho(page)).toContainText('ainda não gravado');

  // Recarregar NÃO descarta o rascunho: ele é indexado pela chave primária e
  // continua colado na sua linha. Descartar é gesto explícito.
  await page.getByLabel('Recarregar a tabela').click();
  await expect(rascunho(page)).toContainText('1 alterada(s)');

  // A prova de que o banco não foi tocado: descartar devolve o valor de lá.
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByRole('cell', { name: 'editado-mas-nao-gravado' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'joshua' })).toBeVisible();
});

test('o rascunho segue a LINHA, não a posição na tela', async ({ page }) => {
  // Indexado pela chave primária: ordenar ou paginar não o desloca para a linha
  // errada, que seria o pior desfecho possível de uma grade editável.
  await abrirTabela(page);
  await editarPrimeiroNome(page, 'colado-na-linha');

  await page.getByLabel('Ordenar por nome').click();
  await page.getByLabel('Ordenar por nome').click();
  await expect(rascunho(page)).toContainText('1 alterada(s)');
  await expect(page.getByRole('cell', { name: 'colado-na-linha' })).toHaveCount(1);
});

test('descartar apaga o rascunho e devolve o valor original', async ({ page }) => {
  await abrirTabela(page);
  await editarPrimeiroNome(page, 'some-daqui');
  await expect(rascunho(page)).toBeVisible();

  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(rascunho(page)).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'some-daqui' })).toHaveCount(0);
});

test('gravar MOSTRA o SQL antes, e recusar não grava nada', async ({ page }) => {
  // É a trava central da spec: você lê o que vai rodar.
  await abrirTabela(page);
  await editarPrimeiroNome(page, 'recusado');

  await page.getByRole('button', { name: 'Gravar…' }).click();
  // O SQL exato aparece no diálogo — é a trava central da spec.
  await expect(page.getByRole('dialog')).toContainText('UPDATE');
  await expect(page.getByRole('dialog')).toContainText('WHERE');
  await responderGravacao(page, false);

  // O rascunho continua lá — recusar não é descartar.
  await expect(rascunho(page)).toBeVisible();

  await page.getByRole('button', { name: 'Descartar' }).click();
  await page.getByLabel('Recarregar a tabela').click();
  await expect(page.getByRole('cell', { name: 'recusado' })).toHaveCount(0);
});

test('confirmando, a alteração vai para o banco e sobrevive ao recarregar', async ({ page }) => {
  await abrirTabela(page);
  await editarPrimeiroNome(page, 'gravado-de-verdade');

  await page.getByRole('button', { name: 'Gravar…' }).click();
  await responderGravacao(page, true);

  await expect(rascunho(page)).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'gravado-de-verdade' })).toBeVisible();

  await page.reload();
  await abrirTabela(page);
  await expect(page.getByRole('cell', { name: 'gravado-de-verdade' })).toBeVisible();
});

test('a coluna de CHAVE não é editável', async ({ page }) => {
  // Trocá-la mudaria a linha que o `WHERE` usa para achar a própria linha.
  await abrirTabela(page);
  const celulaId = page.locator('tbody tr').first().locator('td').nth(2);
  await celulaId.dblclick();
  await expect(page.getByLabel('Valor da célula')).toHaveCount(0);
});

test('em SQL livre a edição some, e a aba diz por quê', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('SQL desta aba').fill('SELECT 1 AS um');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('[data-modo-livre]')).toBeVisible();
  await page.locator('tbody tr').first().locator('td').nth(1).dblclick();
  await expect(page.getByLabel('Valor da célula')).toHaveCount(0);
});

test('acrescentar linha e descartá-la não deixa resto', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Acrescentar linha').click();
  await expect(page.locator('[data-linha-nova]')).toHaveCount(1);
  await expect(rascunho(page)).toContainText('1 nova(s)');

  await page.getByRole('button', { name: 'Descartar esta linha nova' }).click();
  await expect(page.locator('[data-linha-nova]')).toHaveCount(0);
  await expect(rascunho(page)).toHaveCount(0);
});

test('marcar para apagar risca a linha, e só grava com o sim', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Marcar linha 2 para apagar').check();
  await expect(rascunho(page)).toContainText('1 a apagar');

  await page.getByRole('button', { name: 'Gravar…' }).click();
  await responderGravacao(page, true);

  await expect(rascunho(page)).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'maria', exact: true })).toHaveCount(0);
});
