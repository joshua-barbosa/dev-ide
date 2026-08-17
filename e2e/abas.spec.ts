// Estado das abas — a área onde os dois piores defeitos deste projeto nasceram.
import { expect, test } from '@playwright/test';
import { aba, abrirArquivo, confirmar, digitar, editor, rodape } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('trocar de aba preserva conteúdo, cursor e a marca de não salvo', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await digitar(page, '\n// editado');

  await expect(aba(page, 'utils.ts')).toHaveAttribute('data-tab-dirty', 'true');
  await expect(rodape(page)).toContainText('não salvo');

  const posicao = await editor(page).evaluate((el: HTMLTextAreaElement) => el.selectionStart);

  await abrirArquivo(page, 'consulta.sql');
  await expect(editor(page)).not.toHaveValue(/editado/);

  await aba(page, 'utils.ts').click();
  await expect(editor(page)).toHaveValue(/\/\/ editado/);
  await expect(aba(page, 'utils.ts')).toHaveAttribute('data-tab-dirty', 'true');

  const restaurada = await editor(page).evaluate((el: HTMLTextAreaElement) => el.selectionStart);
  expect(restaurada).toBe(posicao);
});

test('abrir arquivo já aberto foca a aba em vez de duplicar', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await abrirArquivo(page, 'utils.ts');

  await expect(page.locator('[data-tab="utils.ts"]')).toHaveCount(1);
  await expect(aba(page, 'utils.ts')).toHaveAttribute('data-tab-active', 'true');
});

test('recusar a confirmação mantém a aba não salva', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await digitar(page, '\n// sujo');
  await expect(aba(page, 'utils.ts')).toHaveAttribute('data-tab-dirty', 'true');

  await aba(page, 'utils.ts').locator('button').click();
  await confirmar(page, false);

  await expect(aba(page, 'utils.ts')).toBeVisible();
});

test('fechar a última aba limpa a barra de status', async ({ page }) => {
  // Regressão real: a barra ficava presa no último arquivo aberto, porque
  // `null` servia tanto para "nenhuma aba" quanto para "aba fechada".
  await abrirArquivo(page, 'utils.ts');
  await expect(rodape(page)).toContainText('utils.ts');

  // Aba limpa fecha direto: não há confirmação a responder. A versão anterior
  // registrava um tratador que nunca disparava — parecia significar algo.
  await aba(page, 'utils.ts').locator('button').click();

  await expect(page.locator('[data-tab]')).toHaveCount(0);
  await expect(rodape(page)).toContainText('nenhum arquivo');
  await expect(rodape(page)).toContainText('Ln 1, Col 1');
  await expect(page.getByText('Nenhuma aba aberta')).toBeVisible();
});

test('trocar de aba muitas vezes não trava a página', async ({ page }) => {
  // Regressão real: salvar o estado no próprio ouvinte que o salvamento
  // disparava causou recursão infinita e travou a aba do navegador.
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');

  for (let i = 0; i < 25; i += 1) {
    await aba(page, 'utils.ts').click();
    await aba(page, 'consulta.sql').click();
  }

  // Se tivesse travado, isto estouraria o tempo limite.
  await expect(aba(page, 'consulta.sql')).toHaveAttribute('data-tab-active', 'true');
  await expect(editor(page)).toHaveValue(/SELECT/);
});
