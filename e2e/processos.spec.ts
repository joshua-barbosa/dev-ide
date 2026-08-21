// A lista de processos (spec 047).
//
// O SQLite não tem processos — é um arquivo, não um servidor. Isso limita o que
// dá para provar aqui, e o que dá é justamente o mais importante: que a IDE diz
// "este banco não tem o conceito" em vez de mostrar uma lista vazia.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirProcessos(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Ver processos/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a conexão oferece ver processos, e a aba abre', async ({ page }) => {
  await abrirProcessos(page);
  await expect(aba(page, `Processos · ${CONEXAO}`)).toBeVisible();
});

test('"não tem o conceito" é dito, e não vira lista vazia', async ({ page }) => {
  // Confundir os dois diria que o servidor está ocioso, quando não há servidor.
  await abrirProcessos(page);
  await expect(page.locator('[data-aviso-processos]')).toContainText('arquivo, não um servidor');
  await expect(page.locator('[data-total-processos]')).toHaveText('');
});

test('reabrir foca a MESMA aba, em vez de duplicar', async ({ page }) => {
  await abrirProcessos(page);
  await painelLateral(page, 'Database').click();
  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Ver processos/ }).click();
  await expect(aba(page, `Processos · ${CONEXAO}`)).toHaveCount(1);
});

test('a aba de processos NÃO mostra o ▷ da barra de abas', async ({ page }) => {
  // Mesmo defeito que a spec 043 encontrou na aba de tabela: o ▷ executaria o
  // editor do grupo, que guarda outro arquivo.
  await abrirProcessos(page);
  await expect(page.getByRole('button', { name: 'Executar consulta' })).toHaveCount(0);
});
