// Dividir a tela entre arquivos (spec 020).
//
// Era o maior item da parte 1 e o único que mexia em contrato já coberto por
// teste. O critério que guiou o desenho: **com um grupo só, tudo se comporta
// como antes** — os vinte testes do store de abas passaram sem uma linha de
// mudança.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, esperarEditorPronto, menu, esperarIdePronta } from './fixtures';

const grupo = (page: Page, n: number) => page.locator(`[data-grupo-editor="${n}"]`);

/** O texto do editor de um grupo, com o espaço inquebrável do Monaco normalizado. */
async function textoDoGrupo(page: Page, n: number): Promise<string> {
  const bruto = await grupo(page, n).locator('.view-lines').innerText();
  return bruto.replace(/\u00a0/g, ' ');
}

async function dividir(page: Page): Promise<void> {
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Split Editor' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a IDE começa com um grupo só', async ({ page }) => {
  await expect(grupo(page, 0)).toBeVisible();
  await expect(grupo(page, 1)).toHaveCount(0);
});

test('Split Editor fica cinza sem aba aberta', async ({ page }) => {
  await menu(page, 'View');
  await expect(page.getByRole('menuitem', { name: 'Split Editor' })).toBeDisabled();
});

test('dividir manda a aba ativa para o segundo grupo', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);

  await expect(grupo(page, 1)).toBeVisible();
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();
  await expect(grupo(page, 1).locator('[data-tab="consulta.sql"]')).toBeVisible();
  // Cada lado tem a própria barra de abas: a aba não pode aparecer nos dois.
  await expect(grupo(page, 0).locator('[data-tab="consulta.sql"]')).toHaveCount(0);
});

test('CADA LADO CARREGA O PRÓPRIO CONTEÚDO', async ({ page }) => {
  // Regressão de um defeito real, encontrado dividindo a tela na mão: ao salvar
  // a aba anterior, o código pegava o editor do grupo ATUAL dela — que, depois
  // de mover, já era o novo e ainda estava em branco. Gravava vazio por cima, e
  // o arquivo aparecia sem nada do outro lado.
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);

  await expect.poll(() => textoDoGrupo(page, 0)).toMatch(/VERSAO/);
  await expect.poll(() => textoDoGrupo(page, 1)).toMatch(/SELECT id, nome FROM alunos/);
});

test('editar de um lado não mexe no outro', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);
  await expect.poll(() => textoDoGrupo(page, 1)).toMatch(/SELECT/);

  await grupo(page, 0).locator('[data-editor]').click();
  await page.keyboard.insertText('// so-do-lado-esquerdo');

  await expect.poll(() => textoDoGrupo(page, 0)).toMatch(/so-do-lado-esquerdo/);
  await expect.poll(() => textoDoGrupo(page, 1)).not.toMatch(/so-do-lado-esquerdo/);
});

test('o foco decide de quem é a barra de status e os comandos', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);

  await expect(grupo(page, 1)).toHaveAttribute('data-grupo-focado', 'true');
  await expect(page.locator('footer')).toContainText('consulta.sql');

  await grupo(page, 0).locator('[data-editor]').click();
  await expect(grupo(page, 0)).toHaveAttribute('data-grupo-focado', 'true');
  await expect(page.locator('footer')).toContainText('utils.ts');
});

test('fechar a última aba de um lado desfaz a divisão', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);
  await expect(grupo(page, 1)).toBeVisible();

  await grupo(page, 1).locator('[data-tab="consulta.sql"]').locator('button').click();

  // Sobrar uma metade em branco seria pior que voltar a um lado só.
  await expect(grupo(page, 1)).toHaveCount(0);
  await expect(grupo(page, 0)).toBeVisible();
});

test('dividir SEMPRE cria um grupo à direita, e não alterna entre dois', async ({ page }) => {
  // Mudou na spec 025. Com dois grupos fixos, alternar fazia sentido; com N,
  // o esperado é o do VS Code — cada divisão abre mais um lado à direita.
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);
  await expect(grupo(page, 1).locator('[data-tab="consulta.sql"]')).toBeVisible();

  await dividir(page);
  // A aba saiu do grupo 1, que ficou vazio e sumiu; ela está no grupo novo.
  await expect(page.locator('[data-grupo-editor]')).toHaveCount(2);
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();
  await expect(page.locator('[data-tab="consulta.sql"]')).toHaveCount(1);
  await expect(grupo(page, 0).locator('[data-tab="consulta.sql"]')).toHaveCount(0);
});

test('abrir pela árvore um arquivo que está do outro lado leva o foco até ele', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);

  await grupo(page, 0).locator('[data-editor]').click();
  await expect(grupo(page, 0)).toHaveAttribute('data-grupo-focado', 'true');

  await abrirArquivo(page, 'consulta.sql');
  // Nem duplica nem fica parado.
  await expect(grupo(page, 1)).toHaveAttribute('data-grupo-focado', 'true');
  await expect(grupo(page, 0).locator('[data-tab="consulta.sql"]')).toHaveCount(0);
});

test('Save All grava os DOIS lados', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);
  await expect.poll(() => textoDoGrupo(page, 1)).toMatch(/SELECT/);

  await grupo(page, 0).locator('[data-editor]').click();
  await page.keyboard.insertText('// esquerdo');
  await grupo(page, 1).locator('[data-editor]').click();
  await page.keyboard.insertText('-- direito');

  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toHaveAttribute('data-tab-dirty', 'true');
  await expect(grupo(page, 1).locator('[data-tab="consulta.sql"]')).toHaveAttribute('data-tab-dirty', 'true');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Save All' }).click();

  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toHaveAttribute('data-tab-dirty', 'false');
  await expect(grupo(page, 1).locator('[data-tab="consulta.sql"]')).toHaveAttribute('data-tab-dirty', 'false');
});

test('um arquivo novo nasce no lado em foco', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await dividir(page);
  await expect(grupo(page, 1)).toHaveAttribute('data-grupo-focado', 'true');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);

  await expect(grupo(page, 1).locator('[data-tab="untitled-1"]')).toBeVisible();
  await expect(grupo(page, 0).locator('[data-tab="untitled-1"]')).toHaveCount(0);
});
