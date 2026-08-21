// Os menus de tabela e de view (spec 040).
//
// A montagem do SQL é testada sem navegador, em `server/__tests__/modelos.test.ts`,
// e contra um banco de verdade em `sqlite.driver.test.ts`. Aqui se prova o que só
// o navegador responde: que o menu tem os itens, que o destrutivo aparece marcado,
// e — o ponto da spec — que escolher `Apagar` **não apaga nada**.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA, VIEW } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, textoDoEditor, esperarIdePronta } from './fixtures';

async function menuDaTabela(page: Page, objeto = TABELA): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');

  // Clique perto da BORDA ESQUERDA da linha, e não no centro: as ações de
  // hover (`Recarregar`, `Filtrar`, `Criar`) aparecem sobre o meio da linha, e
  // o clique do Playwright passa pelo hover antes de descer.
  const categoria = objeto === TABELA ? 'Tables' : 'Views';
  await linhaArvore(page, categoria).click({ position: { x: 24, y: 8 } });
  await expect(linhaArvore(page, objeto)).toBeVisible();
  await linhaArvore(page, objeto).click({ button: 'right' });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o menu da tabela traz os modelos e os destrutivos', async ({ page }) => {
  await menuDaTabela(page);
  for (const item of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'Copiar tabela', 'Apagar (DROP)']) {
    await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
  }
  // O SQLite não tem TRUNCATE — o item não existe, em vez de existir e falhar.
  await expect(page.getByRole('menuitem', { name: /TRUNCATE/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Esvaziar (DELETE)' })).toBeVisible();
});

test('o menu da view NÃO oferece o que não faz sentido nela', async ({ page }) => {
  await menuDaTabela(page, VIEW);
  await expect(page.getByRole('menuitem', { name: 'Apagar view (DROP)' })).toBeVisible();
  for (const item of ['INSERT', 'UPDATE', 'Copiar tabela', 'Esvaziar (DELETE)']) {
    await expect(page.getByRole('menuitem', { name: item, exact: true })).toHaveCount(0);
  }
});

test('o INSERT abre montado com as colunas, sem a chave', async ({ page }) => {
  await menuDaTabela(page);
  await page.getByRole('menuitem', { name: 'INSERT', exact: true }).click();

  await expect.poll(() => textoDoEditor(page)).toContain('INSERT INTO');
  const texto = await textoDoEditor(page);
  expect(texto).toContain('"nome"');
  // `id` é INTEGER PRIMARY KEY: o banco preenche.
  expect(texto).not.toContain('"id"');
});

test('Apagar (DROP) ABRE o comando e NÃO apaga nada', async ({ page }) => {
  // É a decisão central da spec: a ação gera o SQL, e quem roda é o usuário —
  // com o `▷ Run` da spec 038, que mostra o comando antes.
  await menuDaTabela(page);
  await page.getByRole('menuitem', { name: 'Apagar (DROP)' }).click();

  await expect.poll(() => textoDoEditor(page)).toContain('DROP TABLE');
  const texto = await textoDoEditor(page);
  expect(texto).toContain('ainda NÃO rodou');

  // Nenhum diálogo dizendo que "altera o servidor" — porque não altera.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // E a tabela continua na árvore.
  await painelLateral(page, 'Database').click();
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('o comando gerado nasce amarrado à conexão, pronto para o Run', async ({ page }) => {
  // Sem o vínculo da spec 038 o `Run` teria que perguntar a conexão — e a ação
  // de menu sabe de onde saiu.
  await menuDaTabela(page);
  await page.getByRole('menuitem', { name: 'SELECT', exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();

  await expect.poll(() => textoDoEditor(page)).toContain('SELECT');
  await page.locator('.codelens-decoration').first().getByText('Run').click();
  await expect(page.locator('table')).toContainText('joshua');
});
