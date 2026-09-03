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
  const senha = page.getByLabel('Senha mestra', { exact: true });
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
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, 'alunos').dblclick();
  await esperarEditorPronto(page);
  // O nome INTEIRO, ancorado. Com `/consulta|arquivo/` solto, este clique caiu
  // no botão "Importar conexões de um arquivo" da lateral assim que ele passou a
  // existir — ele casa com `arquivo` e vem antes no DOM. O teste executava a
  // importação achando que executava a consulta, e falhava na grade ausente,
  // trinta linhas depois do erro de verdade.
  await page.getByRole('button', { name: /^Executar (consulta|arquivo)$/ }).click();

  // Sem diálogo no caminho, e a grade com os dados.
  await expect(page.getByText('Executar contra qual conexão?')).toHaveCount(0);
  await expect(page.locator('table')).toContainText('joshua');
});

test('a aba de Resultado é a MESMA grade da aba de tabela (spec 070)', async ({ page }) => {
  // Ele: "todo Resultado deveria ser igual ao que tem do 'abrir tabela'".
  // Havia duas grades, e a desta aba não tinha lupa nem painel de aparência —
  // e a spec 068 chegou a afirmar que o CSV ganhava as duas "de graça".
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText("SELECT 'epsilon' AS qual, 42 AS n;\n");
  await lenteDoBloco(page, 0, 'Run').click();
  await expect(aba(page, 'Resultado')).toBeVisible();
  await expect(page.getByText('epsilon', { exact: true })).toBeVisible();

  const resultado = page.locator('[data-grade-de-resultado]');

  // A alça de arrastar, uma por coluna — é o "não consigo aumentar o campo".
  await expect(resultado.locator('[data-alca]')).toHaveCount(2);

  // O painel de aparência, que só existia na aba de tabela.
  await expect(resultado.getByRole('button', { name: 'Aparência da grade' })).toBeVisible();

  // A lupa, que é o que ele pediu de verdade: abre o visor da célula.
  const celula = resultado.getByText('epsilon', { exact: true });
  await celula.hover();
  await resultado.locator('[data-lupa]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Sem tabela conhecida não há chave primária: o visor NÃO promete o valor
  // inteiro — ele diz o que tem, que é a regra da spec 062.
  await expect(page.getByRole('dialog')).toContainText('epsilon');
});

test('um CREATE PROCEDURE é UM statement, e não quatro (T052)', async ({ page }) => {
  // A nota dele na triagem: "hoje o quebrador parte DENTRO do corpo e manda
  // meia query, calado". O CodeLens é onde isso aparece: um `▷ Run` por
  // statement, e um corpo partido virava vários.
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText(
    'CREATE TRIGGER tg AFTER INSERT ON alunos\n' +
      'BEGIN\n' +
      "  SELECT 1;\n" +
      "  SELECT 2;\n" +
      'END;\n' +
      "SELECT 'depois' AS qual;\n"
  );

  // Dois statements, três lentes cada: Run, +Tab e JSON.
  await expect(lentes(page)).toHaveCount(6);

  // E o segundo é o SELECT de fora — prova de que o corpo não vazou.
  await lenteDoBloco(page, 1, 'Run').click();
  await expect(page.getByText('depois', { exact: true })).toBeVisible();
});

test('o autocomplete conhece as TABELAS do banco da aba (T053)', async ({ page }) => {
  // O catálogo é lido uma vez por conexão+banco e guardado. A prova é a lista
  // do Monaco trazendo nome que só existe NAQUELE banco.
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText('select * from al');
  await page.keyboard.press('Control+Space');

  const sugestoes = page.locator('.suggest-widget .monaco-list-row');
  await expect(sugestoes.filter({ hasText: 'alunos' }).first()).toBeVisible({ timeout: 15_000 });
});

test('o autocomplete conhece as COLUNAS, inclusive pelo apelido (T053)', async ({ page }) => {
  // `SELECT a.| FROM alunos a`: o apelido está DEPOIS do cursor, e ler só o
  // prefixo faria isto não sugerir nada — que é o caso mais comum de todos.
  await abrirQueryDoBanco(page);
  await esperarEditorPronto(page);
  await page.keyboard.insertText('select * from alunos a where a.');
  await page.keyboard.press('Control+Space');

  const sugestoes = page.locator('.suggest-widget .monaco-list-row');
  await expect(sugestoes.filter({ hasText: 'nome' }).first()).toBeVisible({ timeout: 15_000 });
  // Coluna, e não tabela: depois do ponto só cabe coluna.
  await expect(sugestoes.filter({ hasText: 'alunos_view' })).toHaveCount(0);
});
