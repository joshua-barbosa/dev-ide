// Arquivo grande ABRE, com menos recursos (spec 091).
//
// O limite era 2 MB e a resposta era um erro — *"Arquivo muito grande para
// abrir no editor (limite de 2 MB)"*. Ele bateu nisso usando a IDE. O número
// não vinha de medida nenhuma, e a recusa não oferecia saída.
import { expect, test } from '@playwright/test';
import { aba, esperarIdePronta, linhaArvore } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('um arquivo de 3 MB abre no editor, sem erro', async ({ page }) => {
  await linhaArvore(page, 'grande.log').click();
  // O que ele viu antes, e não pode mais ver.
  await expect(page.getByText(/muito grande para abrir/)).toHaveCount(0);
  await expect(aba(page, 'grande.log')).toBeVisible();
  await expect(page.locator('.monaco-editor .view-line').first()).toBeVisible();
});

test('acima do limiar, o editor desliga o que custa caro', async ({ page }) => {
  // Um arquivo comum: minimapa desenhado.
  await linhaArvore(page, 'utils.ts').click();
  await expect(page.locator('.monaco-editor .minimap').first()).toBeVisible();

  // O grande: minimapa fora. É o que percorre o texto inteiro a cada tecla.
  await linhaArvore(page, 'grande.log').click();
  await expect(page.locator('.monaco-editor .view-line').first()).toBeVisible();
  await expect(page.locator('.monaco-editor .minimap')).toBeHidden();
});

// O teto de recusa (32 MB) fica no unitário de `shared/arquivo-grande`: gerar
// 40 MB a cada rodada da suíte custaria mais do que prova.
