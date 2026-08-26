// Exportar a tabela INTEIRA, e não só a página (T058 · spec 041).
//
// Na spec 041 eu escrevi que exportar tudo "é outra coisa — varre o banco, não a
// tela". Era verdade, e não era motivo. Ele resgatou da lista dos 114, com uma
// correção: na tela de RESULTADO tem que sair tudo que a query devolveu.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import {
  aba, destrancarCofre, esperarEditorPronto, expandir, linhaArvore, painelLateral,
  esperarIdePronta,
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

// `exact: true` em todo `Exportar` daqui para baixo: a spec 064 acrescentou
// `Exportar conexões COM as senhas` no cabeçalho do painel, e sem o exato o
// seletor casa com os dois. Foi assim que 51 testes ficaram vermelhos de uma
// vez — um botão novo, com um nome que CONTÉM o de outro.

test('o menu diz o ESCOPO, que era a pergunta que faltava', async ({ page }) => {
  await abrirTabela(page);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  // Antes eram dois botões — CSV e JSON — e nenhum dizia o que levava. A
  // resposta era sempre "a página", e ninguém sabia até abrir o arquivo.
  await expect(page.getByRole('menuitem', { name: 'CSV · esta página' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'CSV · a tabela inteira' })).toBeVisible();
});

test('a página vai para uma aba do editor, como antes', async ({ page }) => {
  await abrirTabela(page);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'CSV · esta página' }).click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
});

test('a tabela inteira vira ARQUIVO, com os filtros da tela junto', async ({ page }) => {
  await abrirTabela(page);
  // Filtra para uma linha só: o arquivo tem que ser o que está na tela, e não a
  // tabela toda ignorando o filtro.
  await page.getByLabel('Filtrar nome').fill('josh');
  await expect(page.locator('[data-total-da-tabela]')).toContainText('de 1');

  const baixando = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'CSV · a tabela inteira' }).click();
  const arquivo = await baixando;

  const caminho = await arquivo.path();
  const conteudo = await import('node:fs/promises').then((fs) => fs.readFile(caminho, 'utf8'));
  expect(conteudo).toContain('joshua');
  expect(conteudo).not.toContain('maria');
  // Cabeçalho mais uma linha: o CSV termina em quebra, então a última é vazia.
  expect(conteudo.trim().split('\r\n')).toHaveLength(2);
});

test('em SQL livre `a tabela inteira` NÃO existe: a IDE não sabe o que varrer', async ({ page }) => {
  await abrirTabela(page);
  await page.locator('[data-sql-da-tabela]').fill('select 1 as um');
  await page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' }).click();
  await expect(page.locator('[data-modo-livre]')).toBeVisible();

  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'CSV · esta página' })).toBeVisible();
  // Mesma razão pela qual ali não há paginação nem filtro por coluna.
  await expect(page.getByRole('menuitem', { name: 'CSV · a tabela inteira' })).toHaveCount(0);
});

test('a tela de RESULTADO exporta tudo que a query devolveu', async ({ page }) => {
  // O caso que ELE apontou: "se esse exportar for na tela de resultado, ele
  // precisa exportar tudo que vem do resultado da query e não só o que está na
  // página". A grade de resultado não pagina — o que está ali é o resultado
  // inteiro —, e até agora ela não tinha exportação nenhuma.
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  const linha = linhaArvore(page, 'escola.db');
  await linha.hover();
  await page.getByRole('button', { name: /Abrir Query em/ }).click();

  await esperarEditorPronto(page);
  await page.keyboard.insertText('SELECT nome FROM alunos;\n');
  // Pela lente `Run` do CodeLens, que é o caminho da spec 038.
  await page.locator('.codelens-decoration').first().getByText('Run', { exact: false }).click();
  await expect(aba(page, 'Resultado')).toBeVisible();
  await expect(page.getByText('joshua')).toBeVisible();

  const baixando = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar o resultado em CSV' }).click();
  const arquivo = await baixando;
  const caminho = await arquivo.path();
  const fs = await import('node:fs/promises');
  const conteudo = await fs.readFile(caminho, 'utf8');
  // As DUAS linhas, e não a primeira: é o resultado inteiro.
  expect(conteudo).toContain('joshua');
  expect(conteudo).toContain('maria');
});

// ---- Paginação do RESULTADO (T056) ----

test('o resultado ganha páginas, e NÃO inventa um total', async ({ page }) => {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  const linha = linhaArvore(page, 'escola.db');
  await linha.hover();
  await page.getByRole('button', { name: /Abrir Query em/ }).click();

  await esperarEditorPronto(page);
  await page.keyboard.insertText('SELECT nome FROM alunos;\n');
  await page.locator('.codelens-decoration').first().getByText('Run', { exact: false }).click();
  await expect(aba(page, 'Resultado')).toBeVisible();

  // Duas linhas, bem abaixo do tamanho da página: não há segunda página, e o
  // botão de página nem aparece — seria ruído numa consulta de três linhas.
  await expect(page.locator('[data-pagina-do-resultado]')).toHaveCount(0);
  // E o total NÃO é dito em lugar nenhum: "página 2 de 7" seria chute, porque
  // contar um SELECT arbitrário exige envolvê-lo num COUNT(*) que mente com
  // GROUP BY ou LIMIT próprio.
  await expect(page.getByText(/de \d+ páginas/)).toHaveCount(0);
});
