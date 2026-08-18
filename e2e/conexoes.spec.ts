// Painel de conexões: cofre, árvore, grade e menu de contexto.
//
// Estes testes trancam o cofre, que é estado global do servidor — é a razão de
// a suíte rodar com um worker só.
import { expect, test } from '@playwright/test';
import { bancoDeTeste, CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import {
  aba, confirmar, destrancarCofre, editor, expandir, linhaArvore, painelLateral,
} from './fixtures';

/** Deixa o cofre trancado, que é o estado com que a IDE sempre inicia de fato. */
async function trancarCofre(page: import('@playwright/test').Page): Promise<void> {
  const trancar = page.getByRole('button', { name: /Trancar o cofre/ });
  if (await trancar.isVisible()) await trancar.click();
  await expect(page.getByRole('button', { name: 'Destrancar o cofre' })).toBeVisible();
}

/**
 * Restringe à área do formulário.
 *
 * Precisa ser a região do próprio formulário, e não `main`: `main` engloba a
 * lateral, e o rótulo "Arquivos" da aba de painel casa com o campo "Arquivo"
 * do SQLite. Seletor amplo demais é a mesma armadilha do seletor ambíguo.
 */
function formulario(page: import('@playwright/test').Page) {
  return page.getByRole('form', { name: 'Formulário de conexão' });
}

/** Destranca pelo botão da barra — os testes de formulário não passam pela árvore. */
async function destrancarPeloBotao(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Destrancar o cofre' }).click();
  await destrancarCofre(page, SENHA_MESTRA);
  await expect(page.getByRole('button', { name: 'Nova conexão', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Nova conexão', exact: true }).click();

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

  // Desfaz: deixar a conexão criada faz os testes seguintes verem duas onde
  // esperavam uma, e a falha aparece longe da causa.
  const criada = linhaArvore(page, 'biblioteca');
  await criada.hover();
  await criada.getByRole('button', { name: 'Excluir conexão' }).click();
  await confirmar(page, true);
  await expect(linhaArvore(page, 'biblioteca')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Nova conexão', exact: true }).click();

  await formulario(page).getByLabel('Nome', { exact: true }).fill('sem-arquivo');
  await formulario(page).getByRole('button', { name: 'SQLite', exact: true }).click();
  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();

  await expect(formulario(page).getByText('Campo obrigatório.')).toBeVisible();
  await expect(aba(page, 'Nova conexão')).toBeVisible();
});

test('o cabeçalho traz as ações como ícone, desabilitadas com o cofre trancado', async ({ page }) => {
  // Trancado: recarregar continua valendo (a árvore renderiza sem senha), mas
  // recolher e adicionar não têm o que fazer.
  await expect(page.getByRole('button', { name: 'Recarregar' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Recolher tudo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Nova conexão', exact: true })).toBeDisabled();

  await destrancarPeloBotao(page);
  await expect(page.getByRole('button', { name: 'Recolher tudo' })).toBeEnabled();
});

test('recolher tudo fecha os grupos abertos', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();

  await page.getByRole('button', { name: 'Recolher tudo' }).click();
  await expect(linhaArvore(page, CONEXAO)).toHaveCount(0);
  await expect(linhaArvore(page, 'ACME')).toBeVisible();
});

test('o "+" da pasta abre o formulário com o grupo já preenchido', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME');

  await linhaArvore(page, 'Bancos').hover();
  await page.getByRole('button', { name: 'Nova conexão em "ACME/Bancos"' }).click();

  await expect(formulario(page).getByLabel('Grupo')).toHaveValue('ACME/Bancos');
});

test('renomear a pasta leva os descendentes junto', async ({ page }) => {
  await destrancarPeloBotao(page);

  await linhaArvore(page, 'ACME').hover();
  await page.getByRole('button', { name: 'Renomear "ACME"' }).click();

  const campo = page.getByRole('dialog').getByRole('textbox');
  await campo.fill('ACME SA');
  await page.keyboard.press('Enter');

  await expect(linhaArvore(page, 'ACME SA')).toBeVisible();
  // O subgrupo acompanhou: a conexão continua alcançável por baixo do novo nome.
  await expandir(page, 'ACME SA', 'Bancos');
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();

  // Desfaz: o cofre é estado compartilhado entre os testes desta suíte.
  await linhaArvore(page, 'ACME SA').hover();
  await page.getByRole('button', { name: 'Renomear "ACME SA"' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('ACME');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, 'ACME')).toBeVisible();
});

test('a linha da conexão oferece recarregar e excluir no hover', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');

  const linha = linhaArvore(page, CONEXAO);
  const acoes = linha.locator('.linha-acoes');

  // `toBeVisible()` NÃO serve aqui: para o Playwright, opacity 0 continua
  // visível. Só medir a opacidade prova que as ações estavam escondidas.
  const opacidade = () => acoes.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(await opacidade())).toBe(0);

  await linha.hover();
  await expect.poll(async () => Number(await opacidade())).toBe(1);
  await expect(linha.getByRole('button', { name: 'Recarregar metadados' })).toBeVisible();
  await expect(linha.getByRole('button', { name: 'Excluir conexão' })).toBeVisible();
});

test('excluir pela linha pede confirmação e recusar mantém a conexão', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');

  const linha = linhaArvore(page, CONEXAO);
  await linha.hover();
  await linha.getByRole('button', { name: 'Excluir conexão' }).click();

  // Diálogo do projeto, não do navegador — e destrutivo precisa de confirmação.
  await expect(page.getByRole('dialog')).toContainText(CONEXAO);
  await confirmar(page, false);
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();
});

test('a categoria oferece recarregar, filtrar e criar', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await expect(categoria.getByRole('button', { name: /Recarregar Tables/ })).toBeVisible();
  await expect(categoria.getByRole('button', { name: /Filtrar Tables/ })).toBeVisible();
  await expect(categoria.getByRole('button', { name: /Criar em Tables/ })).toBeVisible();
});

test('filtrar reduz a lista e some quando o filtro é apagado', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toBeVisible();

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Filtrar Tables/ }).click();

  await page.getByRole('dialog').getByRole('textbox').fill('zzz-nao-existe');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, TABELA)).toHaveCount(0);

  // O botão fica destacado: filtro invisível faria parecer que a tabela sumiu.
  await categoria.hover();
  await expect(categoria.getByRole('button', { name: /Filtrar Tables/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await categoria.getByRole('button', { name: /Filtrar Tables/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('criar abre o esqueleto numa aba, sem executar', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Criar em Tables/ }).click();

  await expect(aba(page, 'novo_tables.sql')).toBeVisible();
  await expect(editor(page)).toHaveValue(/CREATE TABLE nova_tabela/);
  // Nada foi executado: não há grade de resultado.
  await expect(page.getByText(/linha\(s\)/)).toHaveCount(0);
});
