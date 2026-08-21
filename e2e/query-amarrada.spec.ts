// A query amarrada à conexão (spec 038).
//
// O que decide onde a query quebra é testado sem navegador, em
// `shared/__tests__/statements.test.ts`; a cerca da pasta e a lembrança do
// vínculo, em `server/__tests__/queries.routes.test.ts`. Aqui se prova o
// caminho de ponta a ponta: abrir a query de um database, ver o `Run` acima de
// CADA statement, rodar o do meio, e o `+Tab` que não sobrepõe o anterior.
//
// A conexão da suíte é SQLite, que roda sem servidor externo — e é o único
// driver cujo database (`main`) existe sem ninguém configurar nada.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import {
  aba, destrancarCofre, esperarEditorPronto, expandir, linhaArvore, painelLateral, rodape,
  esperarIdePronta,
} from './fixtures';

/** As lentes do CodeLens, na ordem em que aparecem na tela. */
const lentes = (page: Page) => page.locator('.codelens-decoration a');

/** As lentes de UM statement, pela ordem do bloco. */
function lenteDoBloco(page: Page, bloco: number, rotulo: string) {
  return page.locator('.codelens-decoration').nth(bloco).getByText(rotulo, { exact: false });
}

async function abrirQueryDoBanco(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  // O cofre pode estar trancado por causa dos testes vizinhos.
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

  const linha = linhaArvore(page, 'escola.db');
  await expect(linha).toBeVisible();
  await linha.hover();
  await page.getByRole('button', { name: /Abrir Query em/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Abrir Query num database abre o arquivo dele, já amarrado', async ({ page }) => {
  await abrirQueryDoBanco(page);

  // O nome do arquivo é o do database, e o vínculo aparece no rodapé sem que
  // ninguém tenha perguntado nada: o CAMINHO já diz contra quem ele roda.
  await expect(aba(page, 'main.sql')).toBeVisible();
  await expect(rodape(page).locator('[data-vinculo="main"]')).toBeVisible();
});

test('cada statement ganha o seu Run, e rodar o do meio roda o do meio', async ({ page }) => {
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText(
    "SELECT 'um' AS qual;\nSELECT 'dois' AS qual;\nSELECT 'tres' AS qual;\n"
  );

  // Três statements, três lentes cada: Run, +Tab e JSON.
  await expect(lentes(page)).toHaveCount(9);

  await lenteDoBloco(page, 1, 'Run').click();
  await expect(aba(page, 'Resultado')).toBeVisible();
  // `dois`, e não `um`: é o statement do meio que foi pedido.
  await expect(page.getByText('dois', { exact: true })).toBeVisible();
  await expect(page.getByText('um', { exact: true })).toHaveCount(0);
});

test('+Tab abre um resultado NOVO, sem sobrepor o anterior', async ({ page }) => {
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText("SELECT 'alfa' AS qual;\nSELECT 'beta' AS qual;\n");

  await lenteDoBloco(page, 0, 'Tab').click();
  await expect(page.getByText('alfa', { exact: true })).toBeVisible();

  await aba(page, 'main.sql').click();
  await lenteDoBloco(page, 1, 'Tab').click();

  // Duas abas de resultado vivas ao mesmo tempo — é a razão de o `+Tab` existir.
  await expect(aba(page, 'Resultado')).toHaveCount(2);
  await expect(page.getByText('beta', { exact: true })).toBeVisible();
});

test('JSON abre o resultado como texto, numa aba sem título', async ({ page }) => {
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText("SELECT 'gama' AS qual;\n");

  await lenteDoBloco(page, 0, 'JSON').click();
  // Objetos, e não vetores: é o que se espera ver ao pedir JSON.
  await expect
    .poll(async () => (await page.locator('.view-line').allTextContents()).join(' '))
    .toContain('"qual"');
});

test('o vínculo some do rodapé quando o foco não é um editor', async ({ page }) => {
  // Achado no navegador: com a aba de RESULTADO em foco, o rodapé anunciava
  // "sem conexão" — porque a linguagem ainda era `sql` e o caminho já era nulo.
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText("SELECT 'delta' AS qual;\n");

  await lenteDoBloco(page, 0, 'Run').click();
  await expect(aba(page, 'Resultado')).toBeVisible();
  await expect(rodape(page).getByText('sem conexão')).toHaveCount(0);
});

test('a categoria Query lista, cria e apaga arquivo', async ({ page }) => {
  await abrirQueryDoBanco(page);

  // A categoria só existe depois de o nó do database ser expandido — é ali que
  // a interface a injeta, sob quem o driver declarou como database.
  await linhaArvore(page, 'escola.db').click();

  const query = linhaArvore(page, 'Query');
  await expect(query).toBeVisible();
  await query.click();
  // O arquivo aberto acima aparece aqui, sem a extensão.
  await expect(linhaArvore(page, 'main')).toBeVisible();

  await query.hover();
  await page.getByRole('button', { name: /Nova query/ }).click();
  // O `+` pergunta O QUE criar antes do nome (spec 049): sem isso, só criava
  // caderno quem soubesse digitar `.sqlbook`.
  await page.getByRole('option', { name: /Query SQL/ }).click();
  await page.getByRole('textbox').fill('relatorio');
  await page.keyboard.press('Enter');
  await expect(aba(page, 'relatorio.sql')).toBeVisible();

  const criada = linhaArvore(page, 'relatorio');
  await expect(criada).toBeVisible();
  await criada.hover();
  await page.getByRole('button', { name: /Apagar relatorio/ }).click();
  await page.getByRole('button', { name: 'Apagar' }).click();

  // Some da árvore E do editor: aba aberta apontando para arquivo apagado seria
  // recriada pelo próximo Ctrl+S.
  await expect(criada).toHaveCount(0);
  await expect(aba(page, 'relatorio.sql')).toHaveCount(0);
});

test('aba de query nascida da árvore NÃO pergunta a conexão', async ({ page }) => {
  // Regressão introduzida pela própria spec 038 e pega pelo teste da spec 009:
  // uma aba aberta de um nó da árvore já sabe conexão e database, e não tem
  // caminho — então o vínculo por caminho não a alcança e ela passou a
  // perguntar o que já sabia. O `meta` da aba entrou na ordem de precedência.
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, 'alunos').dblclick();
  await esperarEditorPronto(page);
  await page.getByRole('button', { name: /consulta|arquivo/ }).first().click();

  // Sem diálogo no caminho, e a grade com os dados.
  await expect(page.getByText('Executar contra qual conexão?')).toHaveCount(0);
  await expect(page.locator('table')).toContainText('joshua');
});
