// Execução de código e painel de saída.
import { expect, test } from '@playwright/test';
import { abrirArquivo, esperarIdePronta } from './fixtures';

test('executar código mostra a saída e o término no painel', async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
  await abrirArquivo(page, 'utils.ts');

  await page.getByRole('button', { name: 'Executar arquivo' }).click();

  const saida = page.locator('pre').last();
  await expect(saida).toContainText('ola do utils');
  await expect(page.getByText(/exit 0/)).toBeVisible();
});
