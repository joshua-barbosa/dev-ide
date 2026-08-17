// Painel de conexões: cofre, árvore, grade e menu de contexto.
//
// Estes testes trancam o cofre, que é estado global do servidor — é a razão de
// a suíte rodar com um worker só.
import { expect, test } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, editor, expandir, linhaArvore, painelLateral, responderDialogo } from './fixtures';

/** Deixa o cofre trancado, que é o estado com que a IDE sempre inicia de fato. */
async function trancarCofre(page: import('@playwright/test').Page): Promise<void> {
  const trancar = page.getByTitle(/Trancar o cofre/);
  if (await trancar.isVisible()) await trancar.click();
  await expect(page.getByRole('button', { name: 'Destrancar' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await painelLateral(page, 'Database').click();
  await expect(linhaArvore(page, 'ACME')).toBeVisible();
  await trancarCofre(page);
});

test('cofre trancado pede a senha ao clicar na conexão e abre a árvore', async ({ page }) => {
  await expect(page.getByText(/Cofre trancado/)).toBeVisible();

  await expandir(page, 'ACME', 'Bancos');
  responderDialogo(page, SENHA_MESTRA); // antes do clique que abre o prompt
  await linhaArvore(page, CONEXAO).click();

  await expect(linhaArvore(page, 'escola.db')).toBeVisible();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('executar consulta abre a grade com colunas tipadas e as linhas', async ({ page }) => {
  // Fecha a pendência que a spec 001 deixou declarada: a grade nunca tinha sido
  // vista com dados reais.
  await expandir(page, 'ACME', 'Bancos');
  responderDialogo(page, SENHA_MESTRA);
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, TABELA).dblclick();
  await expect(editor(page)).toHaveValue(new RegExp(`SELECT \\* FROM ${TABELA}`));

  await page.getByRole('button', { name: /consulta|arquivo/ }).first().click();

  const grade = page.locator('table');
  await expect(grade).toBeVisible();
  await expect(grade.locator('th')).toContainText(['id', 'nome', 'nota']);
  await expect(grade).toContainText('INTEGER');
  await expect(grade).toContainText('joshua');
  await expect(grade).toContainText('maria');
  // Qualificado pelo nome da aba: a contagem também aparece no painel de saída,
  // e um seletor ambíguo falharia por modo estrito em vez de por regressão.
  await expect(page.getByText(new RegExp(`${TABELA}\\.sql · 2 linha\\(s\\)`))).toBeVisible();
});

test('menu do botão direito oferece as ações do nó e abre o DDL', async ({ page }) => {
  await expandir(page, 'ACME', 'Bancos');
  responderDialogo(page, SENHA_MESTRA);
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, TABELA).click({ button: 'right' });

  const menu = page.getByRole('menuitem');
  await expect(menu).toContainText(['Copiar nome', 'Abrir Query', 'Ver DDL']);

  await page.getByRole('menuitem', { name: 'Ver DDL' }).click();
  await expect(aba(page, `${TABELA} (DDL)`)).toBeVisible();
  await expect(editor(page)).toHaveValue(new RegExp(`CREATE TABLE ${TABELA}`));
});
