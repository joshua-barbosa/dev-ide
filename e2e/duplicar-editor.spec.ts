// O mesmo arquivo aberto em dois grupos (T028, spec 072).
//
// A desculpa que eu tinha escrito era *"mudança no modelo, não no arranjo"*.
// O que ela escondia é o risco de verdade: duas abas do mesmo arquivo com dois
// textos, e salvar de um lado apagando o que foi escrito do outro. Estes testes
// existem para provar que isso NÃO acontece — as duas vistas dividem um texto
// só, na mesma tecla.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, esperarEditorPronto, esperarIdePronta, menu } from './fixtures';

const grupo = (page: Page, n: number) => page.locator(`[data-grupo-editor="${n}"]`);

/** O texto do editor de um grupo, com o espaço inquebrável do Monaco normalizado. */
async function textoDoGrupo(page: Page, n: number): Promise<string> {
  const bruto = await grupo(page, n).locator('.view-lines').first().innerText();
  return bruto.replace(/\u00a0/g, ' ');
}

/**
 * O item `Duplicate Editor`, e não o `Duplicate Editor Down`.
 *
 * `getByRole` casa por PEDAÇO do nome. É a mesma armadilha do `Split Editor`
 * (D104), e desta vez o teste já nasce ancorado.
 */
const itemDeDuplicar = (page: Page, baixo = false) =>
  page.getByRole('menuitem', {
    name: baixo ? /^Duplicate Editor Down$/ : /^Duplicate Editor$/,
  });

async function duplicar(page: Page, baixo = false): Promise<void> {
  await menu(page, 'View');
  await itemDeDuplicar(page, baixo).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Duplicate Editor fica cinza sem arquivo aberto', async ({ page }) => {
  await menu(page, 'View');
  await expect(itemDeDuplicar(page)).toBeDisabled();
});

test('o arquivo passa a aparecer nos DOIS grupos', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await duplicar(page);

  await expect(grupo(page, 1)).toBeVisible();
  // A original FICA. É a diferença para o Split Editor, que a manda embora.
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();
  await expect(grupo(page, 1).locator('[data-tab="utils.ts"]')).toBeVisible();
  expect(await textoDoGrupo(page, 1)).toContain('VERSAO');
});

test('digitar de um lado aparece no outro NA MESMA TECLA', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await duplicar(page);

  // O foco fica no grupo novo depois de duplicar; volta-se ao original.
  await grupo(page, 0).locator('[data-editor]').click();
  await page.keyboard.insertText('// ZORBAX');

  // Sem trocar de aba nenhuma: o modelo é o mesmo, então o outro lado já
  // mostra o texto novo.
  await expect.poll(() => textoDoGrupo(page, 1)).toMatch(/ZORBAX/);
});

test('as duas vistas sujam e limpam juntas', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await duplicar(page);

  await grupo(page, 0).locator('[data-editor]').click();
  // Um COMENTÁRIO, e não um `x` solto. Este teste GRAVA em `utils.ts`, e o
  // arquivo é o mesmo que `execucao.spec.ts` manda executar depois: com o `x`,
  // ele saía com `ReferenceError` e `exit 1`, e a falha aparecia trinta testes
  // adiante, num arquivo que não tinha nada a ver com isto.
  await page.keyboard.insertText('// sujo');

  const abaA = grupo(page, 0).locator('[data-tab="utils.ts"]');
  const abaB = grupo(page, 1).locator('[data-tab="utils.ts"]');
  await expect(abaA).toHaveAttribute('data-tab-dirty', 'true');
  // Se só uma sujasse, fechar a outra não avisaria nada — e o F5 perguntaria
  // por uma e não pela outra.
  await expect(abaB).toHaveAttribute('data-tab-dirty', 'true');

  await page.keyboard.press('Control+s');
  await expect(abaA).toHaveAttribute('data-tab-dirty', 'false');
  await expect(abaB).toHaveAttribute('data-tab-dirty', 'false');

  // Devolve o arquivo como estava. A suíte compartilha o projeto de exemplo, e
  // teste que grava e não desfaz cobra o preço de quem vier depois.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+s');
  await expect(abaA).toHaveAttribute('data-tab-dirty', 'false');
});

test('fechar uma das vistas NÃO pergunta nada, e a outra fica com o texto', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await duplicar(page);

  await grupo(page, 0).locator('[data-editor]').click();
  await page.keyboard.insertText('// FICA');

  // A gêmea segura o texto: perguntar "fechar sem salvar?" seria alarme falso.
  await grupo(page, 1).getByRole('button', { name: 'Fechar utils.ts' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(grupo(page, 1)).toHaveCount(0);
  expect(await textoDoGrupo(page, 0)).toContain('FICA');
});

test('Duplicate Editor Down empilha as duas vistas', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await duplicar(page, true);

  await expect(page.locator('[data-divisao="vertical"]')).toHaveCount(1);
  await expect(grupo(page, 1).locator('[data-tab="utils.ts"]')).toBeVisible();
});

test('as duas vistas voltam depois do F5', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await duplicar(page);
  await expect(grupo(page, 1).locator('[data-tab="utils.ts"]')).toBeVisible();

  await page.reload();
  await esperarIdePronta(page);

  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();
  await expect(grupo(page, 1).locator('[data-tab="utils.ts"]')).toBeVisible();
  expect(await textoDoGrupo(page, 1)).toContain('VERSAO');
});
