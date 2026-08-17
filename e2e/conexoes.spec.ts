// Painel de conexões: cofre, árvore, grade e menu de contexto.
//
// Estes testes trancam o cofre, que é estado global do servidor — é a razão de
// a suíte rodar com um worker só.
import { expect, test } from '@playwright/test';
import { bancoDeTeste, CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, editor, expandir, linhaArvore, painelLateral } from './fixtures';

/** Deixa o cofre trancado, que é o estado com que a IDE sempre inicia de fato. */
async function trancarCofre(page: import('@playwright/test').Page): Promise<void> {
  const trancar = page.getByTitle(/Trancar o cofre/);
  if (await trancar.isVisible()) await trancar.click();
  await expect(page.getByRole('button', { name: 'Destrancar' })).toBeVisible();
}

/**
 * Restringe à área do formulário.
 *
 * A barra de ferramentas também tem um botão "salvar" (o do editor), e sem
 * qualificar a busca casa nos dois. Seletor ambíguo é semente de falha
 * intermitente — a mesma lição da spec 003.
 */
function formulario(page: import('@playwright/test').Page) {
  return page.getByRole('main');
}

/** Destranca pelo botão da barra — os testes de formulário não passam pela árvore. */
async function destrancarPeloBotao(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Destrancar' }).click();
  await destrancarCofre(page, SENHA_MESTRA);
  await expect(page.getByRole('button', { name: 'conexão' })).toBeVisible();
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
  await linhaArvore(page, CONEXAO).click();
  await destrancarCofre(page, SENHA_MESTRA);

  await expect(linhaArvore(page, 'escola.db')).toBeVisible();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('senha errada mantém o diálogo aberto, com o aviso', async ({ page }) => {
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();

  await destrancarCofre(page, 'senha-que-nao-e-a-certa');
  await expect(page.getByText(/Senha mestra incorreta/i)).toBeVisible();
  // O diálogo continua de pé: errar não pode custar recomeçar do zero.
  await expect(page.getByLabel('Senha mestra')).toBeVisible();

  await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'escola.db')).toBeVisible();
});

test('a caixa de lembrar nasce desmarcada', async ({ page }) => {
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();

  // Lembrar é escolha consciente por sessão, nunca o padrão silencioso.
  await expect(page.getByRole('checkbox', { name: /Lembrar neste computador/ })).not.toBeChecked();
});

test('executar consulta abre a grade com colunas tipadas e as linhas', async ({ page }) => {
  // Fecha a pendência que a spec 001 deixou declarada: a grade nunca tinha sido
  // vista com dados reais.
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await destrancarCofre(page, SENHA_MESTRA);
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
  await linhaArvore(page, CONEXAO).click();
  await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, TABELA).click({ button: 'right' });

  const menu = page.getByRole('menuitem');
  await expect(menu).toContainText(['Copiar nome', 'Abrir Query', 'Ver DDL']);

  await page.getByRole('menuitem', { name: 'Ver DDL' }).click();
  await expect(aba(page, `${TABELA} (DDL)`)).toBeVisible();
  await expect(editor(page)).toHaveValue(new RegExp(`CREATE TABLE ${TABELA}`));
});

test('cadastra uma conexão pelo formulário e ela aparece na árvore', async ({ page }) => {
  await destrancarPeloBotao(page);
  await page.getByRole('button', { name: 'conexão' }).click();

  await expect(aba(page, 'Nova conexão')).toBeVisible();
  await formulario(page).getByLabel('Nome', { exact: true }).fill('biblioteca');
  await formulario(page).getByLabel('Grupo').fill('ACME/Bancos');

  // A grade de tipos sai dos metadados do driver — nenhum nome de campo é fixo
  // na interface.
  await formulario(page).getByRole('button', { name: 'SQLite', exact: true }).click();
  await formulario(page).getByLabel('Arquivo').fill(bancoDeTeste());

  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();

  await expect(aba(page, 'Nova conexão')).toHaveCount(0);
  await expandir(page, 'ACME', 'Bancos');
  await expect(linhaArvore(page, 'biblioteca')).toBeVisible();
});

test('editar não pede a senha de novo e mantém a conexão funcionando', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');

  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByText('Editar conexão…').click();

  // Nem tipo, nem arquivo: só o rótulo muda. O segredo (quando houver) fica
  // guardado, e é justamente por o campo ir em branco que ele sobrevive.
  await expect(aba(page, CONEXAO)).toBeVisible();
  await formulario(page).getByLabel('Nome', { exact: true }).fill('escola-renomeada');
  await formulario(page).getByRole('button', { name: 'salvar e conectar' }).click();

  await expect(linhaArvore(page, 'escola-renomeada')).toBeVisible();
  // Conectou de fato: a árvore do banco abriu.
  await expect(linhaArvore(page, 'escola.db')).toBeVisible();

  // Desfaz: a suíte roda com um worker só contra UM servidor, então o cofre é
  // estado compartilhado. Um teste que renomeia e não restaura faz o seguinte
  // procurar um nome que não existe mais — e a falha aparece no teste errado.
  await linhaArvore(page, 'escola-renomeada').click({ button: 'right' });
  await page.getByText('Editar conexão…').click();
  await formulario(page).getByLabel('Nome', { exact: true }).fill(CONEXAO);
  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();
});

test('o tipo não pode ser trocado ao editar', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByText('Editar conexão…').click();

  await expect(formulario(page).getByRole('button', { name: 'SQLite', exact: true })).toBeDisabled();
});

test('campo obrigatório vazio é recusado sem ida ao servidor', async ({ page }) => {
  await destrancarPeloBotao(page);
  await page.getByRole('button', { name: 'conexão' }).click();

  await formulario(page).getByLabel('Nome', { exact: true }).fill('sem-arquivo');
  await formulario(page).getByRole('button', { name: 'SQLite', exact: true }).click();
  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();

  await expect(formulario(page).getByText('Campo obrigatório.')).toBeVisible();
  await expect(aba(page, 'Nova conexão')).toBeVisible();
});
