// `Ctrl+P` por NOME de arquivo (T051, spec 073).
//
// O que existia antes pedia caminho absoluto, digitado inteiro — isso não é
// achar arquivo, é ter que saber onde ele está.
//
// O ranking é testado sem navegador (`shared/__tests__/busca-de-arquivo.ts`).
// Aqui se prova o caminho: a tecla abre, o que se digita filtra, `Enter` abre o
// arquivo, e os recentes ficam no topo.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, entradaRapida, esperarIdePronta } from './fixtures';

const caixa = (page: Page) => page.getByRole('dialog', { name: 'Ir para arquivo' });
const itens = (page: Page) => caixa(page).getByRole('option');

async function abrirBusca(page: Page): Promise<void> {
  await page.keyboard.press('Control+p');
  await expect(entradaRapida(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Ctrl+P lista os arquivos da pasta, e não pede caminho', async ({ page }) => {
  await abrirBusca(page);
  await expect(caixa(page)).toBeVisible();
  await expect(itens(page).filter({ hasText: 'utils.ts' }).first()).toBeVisible();
});

test('o .gitignore vale aqui também', async ({ page }) => {
  // Ninguém abre `node_modules/dep.js` pelo Ctrl+P, e ter mil deles empurraria
  // para baixo o arquivo que se procura.
  await abrirBusca(page);
  await expect(itens(page).filter({ hasText: 'dep.js' })).toHaveCount(0);
});

test('as letras não precisam ser vizinhas', async ({ page }) => {
  await abrirBusca(page);
  await entradaRapida(page).fill('usli');
  // `usli` casa `usa-lib.ts` — é a diferença entre "contém" e subsequência.
  await expect(itens(page).first()).toContainText('usa-lib.ts');
});

test('Enter abre o arquivo escolhido', async ({ page }) => {
  await abrirBusca(page);
  await entradaRapida(page).fill('consul');
  await entradaRapida(page).press('Enter');
  await expect(page.locator('[data-tab="consulta.sql"]')).toBeVisible();
});

test('com o campo vazio, os RECENTES vêm no topo', async ({ page }) => {
  await abrirArquivo(page, 'lib.ts');
  await abrirArquivo(page, 'consulta.sql');

  await abrirBusca(page);
  // O último aberto primeiro: `Ctrl+P` + `Enter` volta ao arquivo anterior.
  await expect(itens(page).nth(0)).toContainText('consulta.sql');
  await expect(itens(page).nth(1)).toContainText('lib.ts');
  await expect(itens(page).nth(0)).toContainText('recente');
});

test('o que foi digitado manda na ordem, e não a recência', async ({ page }) => {
  await abrirArquivo(page, 'consulta.sql');
  await abrirBusca(page);
  await entradaRapida(page).fill('lib.ts');

  // O contrário poria um arquivo que casou de raspão acima do que casou
  // perfeitamente — e isso se sente como a busca ignorando o que foi digitado.
  await expect(itens(page).first()).toContainText('lib.ts');
});

test('a lista de recentes sobrevive ao F5', async ({ page }) => {
  await abrirArquivo(page, 'lib.ts');
  await page.reload();
  await esperarIdePronta(page);

  await abrirBusca(page);
  await expect(itens(page).first()).toContainText('lib.ts');
});

test('nada casando não deixa a caixa quebrada', async ({ page }) => {
  await abrirBusca(page);
  await entradaRapida(page).fill('zzzzzzz');
  await expect(itens(page)).toHaveCount(0);
  // A caixa diz que não achou, em vez de ficar vazia sem explicação.
  await expect(caixa(page)).toContainText('Nada encontrado');
});

test('File → Open File… continua pedindo o caminho', async ({ page }) => {
  // Os dois gestos são diferentes de propósito: um acha na pasta aberta, o
  // outro abre qualquer coisa da máquina.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Open File/ }).click();
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).toBeVisible();
});
