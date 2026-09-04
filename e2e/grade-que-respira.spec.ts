// O que ele pediu ao comparar a nossa grade com a da ferramenta que a Braytech
// Code substitui (spec 102).
//
// Ele mandou os dois prints lado a lado e escreveu: *"percebe que tem um design
// mais agradável aos olhos?"*. Este arquivo guarda as quatro diferenças que
// respondiam por isso — e as guarda MEDINDO, e não perguntando se o elemento
// existe: metade delas é sobre espaço e sobre o que se lê, não sobre presença.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import {
  aba, destrancarCofre, esperarEditorPronto, esperarIdePronta, expandir, linhaArvore, painelLateral,
} from './fixtures';

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, TABELA).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

/**
 * Abre a aba `Result` executando um SQL no EDITOR.
 *
 * O campo `SQL desta aba` da tabela é outra coisa: ele repinta a PRÓPRIA
 * tabela, e não abre resultado nenhum.
 */
async function abrirResultado(page: Page, sql: string): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');
  await linhaArvore(page, TABELA).dblclick();

  // O duplo clique na tabela já deixou um `SELECT * FROM …` no editor: apaga
  // e escreve por cima, com o teclado, que é como o Monaco recebe texto.
  await esperarEditorPronto(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(sql);
  await page.getByRole('button', { name: /^Executar (consulta|arquivo)$/ }).click();
  await expect(page.locator('[data-grade-de-resultado]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a seta abre a LINHA, e mostra cada coluna com o nome ao lado', async ({ page }) => {
  await abrirTabela(page);

  // Fechada, a linha aberta não existe — e não é só invisível.
  await expect(page.locator('[data-linha-aberta]')).toHaveCount(0);

  await page.locator('[data-abrir-linha]').first().click();
  const aberta = page.locator('[data-linha-aberta]');
  await expect(aberta).toHaveCount(1);
  // Cada coluna com o NOME ao lado: é o que faz ler uma linha larga sem rolar
  // a tabela de lado.
  await expect(aberta).toContainText('nome');
  await expect(aberta).toContainText('id');
});

test('só UMA linha aberta por vez — várias voltariam a empurrar o resto', async ({ page }) => {
  await abrirTabela(page);
  const setas = page.locator('[data-abrir-linha]');

  await setas.nth(0).click();
  await expect(page.locator('[data-linha-aberta]')).toHaveCount(1);
  await setas.nth(1).click();
  await expect(page.locator('[data-linha-aberta]')).toHaveCount(1);

  // Clicar na mesma seta de novo FECHA.
  await setas.nth(1).click();
  await expect(page.locator('[data-linha-aberta]')).toHaveCount(0);
});

test('o cabeçalho respira mais que a linha de dado', async ({ page }) => {
  await abrirTabela(page);
  const alturas = await page.evaluate(() => {
    const th = document.querySelector('[data-grade] thead th[data-coluna]') as HTMLElement;
    const td = document.querySelector('[data-grade] tbody td[data-celula-da-coluna]') as HTMLElement;
    return { th: th.getBoundingClientRect().height, td: td.getBoundingClientRect().height };
  });
  // Não é um número mágico: o ponto é que o cabeçalho — que tem duas linhas,
  // nome e tipo — não fique mais apertado que a linha de dado.
  expect(alturas.th).toBeGreaterThan(alturas.td);
});

test('célula sem valor mostra `(NULL)`, com parênteses', async ({ page }) => {
  await abrirResultado(page, 'SELECT NULL AS vazio, 1 AS cheio');

  const celula = page.locator('[data-celula-da-coluna="vazio"]').first();
  // Os parênteses fazem o que o itálico sozinho não fazia: dizer que aquilo é a
  // AUSÊNCIA de valor, e não uma célula cujo texto é a palavra NULL.
  await expect(celula).toHaveText('(NULL)');
  // A DICA aqui não é o valor: numa grade de `Result` ela explica por que a
  // célula não se edita. É o certo, e é por isso que o teste não a exige.
});

test('buscar no resultado filtra o que JÁ veio, e diz quantas de quantas', async ({ page }) => {
  await abrirResultado(
    page,
    "SELECT 'Turma A' AS turma UNION ALL SELECT 'Turma B' UNION ALL SELECT 'Turma C'"
  );
  const grade = page.locator('[data-grade-de-resultado]');
  await expect(grade).toContainText('3 linha(s)');

  await grade.getByLabel('Buscar no resultado').fill('turma b');
  // Sem ligar para maiúscula, e sem voltar ao banco: o total continua sendo 3.
  await expect(grade).toContainText('1 de 3 linha(s)');
  await expect(grade.locator('[data-celula-da-coluna="turma"]')).toHaveCount(1);

  // Apagar devolve tudo, e o rótulo volta a ser o simples.
  await grade.getByLabel('Buscar no resultado').fill('');
  await expect(grade).toContainText('3 linha(s)');
  await expect(grade.locator('[data-celula-da-coluna="turma"]')).toHaveCount(3);
});

test('busca que não acha nada mostra ZERO linhas, e não a lista inteira', async ({ page }) => {
  await abrirResultado(page, "SELECT 'Turma A' AS turma");
  const grade = page.locator('[data-grade-de-resultado]');
  await grade.getByLabel('Buscar no resultado').fill('zebra');
  await expect(grade).toContainText('0 de 1 linha(s)');
  await expect(grade.locator('[data-celula-da-coluna="turma"]')).toHaveCount(0);
});
