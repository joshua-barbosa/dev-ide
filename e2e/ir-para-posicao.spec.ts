// Clicar em "Ln x, Col y" para ir a uma posição (spec 026).
//
// Pedido do usuário: *"ali na parte que mostra 'Ln 1, Col 1', poderia ser
// clicável para digitar 'Line:Column' e ir para a linha e coluna do cursor no
// arquivo aberto. Igual o que o VSCode faz"*.
//
// A interpretação do texto é testada sem navegador em
// `shared/__tests__/posicao.test.ts`; aqui se prova o caminho — clicar, digitar,
// e o cursor estar onde se pediu.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, cursorDoEditor, entradaRapida, menu } from './fixtures';

const indicador = (page: Page) => page.getByRole('button', { name: 'Ir para linha e coluna' });

async function irPara(page: Page, texto: string): Promise<void> {
  await indicador(page).click();
  await expect(entradaRapida(page)).toBeVisible();
  await entradaRapida(page).fill(texto);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('sem arquivo aberto o indicador fica inerte', async ({ page }) => {
  await expect(indicador(page)).toBeDisabled();
});

test('clicar abre a caixa, e o número leva ao começo da linha', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await expect(cursorDoEditor(page)).resolves.toBe('Ln 1, Col 1');

  await irPara(page, '3');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 1');
});

test('linha:coluna leva às duas, como no VS Code', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await irPara(page, '3:8');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 8');
});

test('a vírgula também serve — é o formato que a própria barra mostra', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  // Linha 3, e não 2: a 2 é vazia, e o Monaco limita a coluna ao fim da linha —
  // corretamente. Mirar numa linha vazia testaria o limite, não a vírgula.
  await irPara(page, '3,4');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 4');
});

test('coluna além do fim da linha para no fim dela', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await irPara(page, '2:40');
  // Quem limita é o editor, que conhece o tamanho da linha; o interpretador não.
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 2, Col 1');
});

test('a caixa diz até que linha o arquivo vai', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await indicador(page).click();
  // A dica é o `placeholder` do campo, e não texto na tela — `toContainText`
  // não a alcança.
  await expect(entradaRapida(page)).toHaveAttribute('placeholder', /Linha entre 1 e \d+/);
  await page.keyboard.press('Escape');
});

test('linha maior que o arquivo vai para o FIM, e não recusa', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await irPara(page, '9999');
  // Quem digita 9999 está dizendo "o final".
  await expect.poll(() => cursorDoEditor(page)).toMatch(/^Ln [1-9]\d*, Col 1$/);
  await expect.poll(() => cursorDoEditor(page)).not.toBe('Ln 9999, Col 1');
});

test('texto sem sentido não move o cursor', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await irPara(page, '3');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 1');

  await irPara(page, 'abc');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 1');
});

test('cancelar não move nada', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await irPara(page, '3:2');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 2');

  await indicador(page).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 2');
});

test('Ctrl+G abre a MESMA caixa', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await menu(page, 'Go');
  await page.getByRole('menuitem', { name: /Go to Line/ }).click();

  await expect(page.getByRole('dialog').last()).toContainText('Ir para linha e coluna');
  // Linha 3: a 2 é vazia, e o editor limitaria a coluna a 1.
  await entradaRapida(page).fill('3:3');
  await page.keyboard.press('Enter');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 3, Col 3');
});

test('o salto entra no histórico do Back', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await irPara(page, '1:5');
  await expect.poll(() => cursorDoEditor(page)).toBe('Ln 1, Col 5');

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('[data-tab-active="true"]')).toHaveAttribute('data-tab', 'utils.ts');
});
