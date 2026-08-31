// Arrastar para reordenar abas (T029, spec 072).
//
// A aritmética de "antes de qual aba" é provada sem navegador
// (`shared/__tests__/arrastar.test.ts` e `tabs.test.ts`). Aqui se prova o
// caminho: arrastar de verdade, ver a linha da inserção, soltar, e a fila ficar
// na ordem nova — inclusive depois do F5, que é onde a ordem se perderia se ela
// não morasse no mesmo lugar que a sessão.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirArquivo, esperarIdePronta } from './fixtures';

const grupo = (page: Page, n: number) => page.locator(`[data-grupo-editor="${n}"]`);

/** Os títulos das abas de um grupo, na ordem em que estão na barra. */
async function fila(page: Page, n: number): Promise<string[]> {
  return grupo(page, n).locator('[data-tab]').evaluateAll((nos) =>
    nos.map((no) => no.getAttribute('data-tab') ?? '')
  );
}

const abaDoGrupo = (page: Page, n: number, titulo: string): Locator =>
  grupo(page, n).locator(`[data-tab="${titulo}"]`);

/**
 * Arrasta uma aba e para sobre a fração pedida da largura do alvo.
 *
 * Sem a parada antes de soltar não há como ver a linha da inserção — e ela é
 * metade da feature: sem ela, soltar entre duas abas é adivinhação.
 */
async function arrastarAba(
  page: Page,
  origem: Locator,
  alvo: Locator,
  fracaoX: number
): Promise<void> {
  await origem.hover();
  await page.mouse.down();
  const r = await alvo.boundingBox();
  if (r === null) throw new Error('a aba de destino não está na tela');
  const x = r.x + r.width * fracaoX;
  const y = r.y + r.height / 2;
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x, y, { steps: 2 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await abrirArquivo(page, 'lib.ts');
  expect(await fila(page, 0)).toEqual(['utils.ts', 'consulta.sql', 'lib.ts']);
});

test('arrastar para a metade ESQUERDA põe a aba antes da mirada', async ({ page }) => {
  await arrastarAba(page, abaDoGrupo(page, 0, 'lib.ts'), abaDoGrupo(page, 0, 'utils.ts'), 0.2);

  // A promessa antes da soltura.
  await expect(abaDoGrupo(page, 0, 'utils.ts')).toHaveAttribute('data-insercao', 'antes');
  await page.mouse.up();

  expect(await fila(page, 0)).toEqual(['lib.ts', 'utils.ts', 'consulta.sql']);
});

test('arrastar para a metade DIREITA põe a aba depois da mirada', async ({ page }) => {
  // `utils.ts` para a direita de `consulta.sql` — o caso que erra por um quando
  // a conta é feita com índice em vez de "antes de qual".
  await arrastarAba(page, abaDoGrupo(page, 0, 'utils.ts'), abaDoGrupo(page, 0, 'consulta.sql'), 0.8);
  await page.mouse.up();

  expect(await fila(page, 0)).toEqual(['consulta.sql', 'utils.ts', 'lib.ts']);
});

test('soltar na metade direita da última manda para o fim', async ({ page }) => {
  await arrastarAba(page, abaDoGrupo(page, 0, 'utils.ts'), abaDoGrupo(page, 0, 'lib.ts'), 0.9);
  await expect(abaDoGrupo(page, 0, 'lib.ts')).toHaveAttribute('data-insercao', 'depois');
  await page.mouse.up();

  expect(await fila(page, 0)).toEqual(['consulta.sql', 'lib.ts', 'utils.ts']);
});

test('reordenar traz a aba arrastada para a frente', async ({ page }) => {
  await abaDoGrupo(page, 0, 'consulta.sql').click();
  await arrastarAba(page, abaDoGrupo(page, 0, 'lib.ts'), abaDoGrupo(page, 0, 'utils.ts'), 0.2);
  await page.mouse.up();

  await expect(abaDoGrupo(page, 0, 'lib.ts')).toHaveAttribute('data-tab-active', 'true');
});

test('soltar sobre a própria aba não muda a fila', async ({ page }) => {
  await arrastarAba(page, abaDoGrupo(page, 0, 'consulta.sql'), abaDoGrupo(page, 0, 'consulta.sql'), 0.3);
  await page.mouse.up();

  expect(await fila(page, 0)).toEqual(['utils.ts', 'consulta.sql', 'lib.ts']);
});

test('soltar na BARRA não divide a tela', async ({ page }) => {
  await arrastarAba(page, abaDoGrupo(page, 0, 'lib.ts'), abaDoGrupo(page, 0, 'utils.ts'), 0.2);
  // O indicador de divisão do grupo não pode estar aceso ao mesmo tempo: são
  // duas promessas diferentes para o mesmo gesto.
  await expect(page.locator('[data-zona-de-soltura]')).toHaveCount(0);
  await page.mouse.up();

  await expect(page.locator('[data-grupo-editor]')).toHaveCount(1);
});

test('a ordem nova sobrevive ao F5', async ({ page }) => {
  await arrastarAba(page, abaDoGrupo(page, 0, 'lib.ts'), abaDoGrupo(page, 0, 'utils.ts'), 0.2);
  await page.mouse.up();
  expect(await fila(page, 0)).toEqual(['lib.ts', 'utils.ts', 'consulta.sql']);

  await page.reload();
  await esperarIdePronta(page);
  await expect(abaDoGrupo(page, 0, 'lib.ts')).toBeVisible();
  expect(await fila(page, 0)).toEqual(['lib.ts', 'utils.ts', 'consulta.sql']);
});
