// A aba Símbolos, que agora busca sozinha (spec 090, D222).
//
// Ela deixou de receber a lista pronta no retrato do espaço: ler e analisar o
// projeto inteiro custava 588 ms de event loop travado num repositório pequeno,
// em toda subida e depois de cada criar, renomear e excluir — e num projeto
// grande era o congelamento que ele descreveu no Windows.
//
// Agora a lista chega quando a aba abre. É por isso que este arquivo existe: o
// caminho novo é o da tela, e nenhum teste de unidade passa por ele.
import { expect, test } from '@playwright/test';
import { esperarIdePronta } from './fixtures';

const aba = (page: import('@playwright/test').Page, nome: string) =>
  page.getByRole('tab', { name: nome });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('abrir a aba Símbolos traz os símbolos do projeto', async ({ page }) => {
  // `utils.ts` da pasta demo tem `export const VERSAO = "1.0";`.
  await expect(page.getByText('VERSAO')).toHaveCount(0);
  await aba(page, 'Símbolos').click();
  await expect(page.getByText('VERSAO')).toBeVisible();
  await expect(page.getByText('Constantes')).toBeVisible();
});

test('o retrato do espaço NÃO carrega símbolos — é o defeito que travava a IDE', async ({ page }) => {
  const retrato = await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    return (await r.json()).data as Record<string, unknown>;
  });
  expect(retrato).not.toHaveProperty('simbolos');
  // E diz a plataforma, que é o que a árvore usa para separar caminho (D223).
  expect(['win32', 'darwin', 'linux']).toContain(retrato.plataforma);
});

test('Recarregar refaz a lista sem sair da aba', async ({ page }) => {
  await aba(page, 'Símbolos').click();
  await expect(page.getByText('VERSAO')).toBeVisible();
  await page.getByRole('button', { name: 'Recarregar', exact: true }).last().click();
  await expect(page.getByText('VERSAO')).toBeVisible();
});
