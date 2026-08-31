// Mais de uma pasta no mesmo espaço de trabalho (T004, spec 073).
//
// A desculpa que eu tinha escrito era *"contamina cada consulta de árvore,
// símbolo e busca"* — que é a descrição do trabalho, não um motivo. A nota dele
// foi exatamente sobre isso: *"árvore, busca e Ctrl+P cobrindo todas as
// pastas"*, e é o que estes testes conferem.
//
// **A regra que este arquivo protege:** com UMA raiz, a tela é exatamente a de
// antes. Foi o critério para não reescrever o painel inteiro.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, esperarIdePronta, linhaArvore, menu } from './fixtures';
import { PASTA_DEMO } from './global-setup';

/** A segunda raiz, criada ao lado da pasta demo. */
function segundaPasta(): string {
  const demo = PASTA_DEMO(process.env.E2E_DATA ?? '');
  const dir = path.join(path.dirname(demo), 'segunda');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'so-da-segunda.ts'), 'export const SEGUNDA = 2;\n');
  return dir;
}

/** Desce pelo navegador de pastas até a pasta dada e confirma. */
async function escolherPasta(page: Page, alvo: string): Promise<void> {
  const campo = entradaRapida(page);
  await expect(campo).toBeVisible();
  // O navegador começa na pasta aberta; sobe uma e desce na irmã.
  await campo.fill('..');
  await page.getByRole('option').filter({ hasText: '..' }).first().click();
  await expect(campo).toBeVisible();
  await campo.fill(path.basename(alvo));
  await page.getByRole('option').filter({ hasText: path.basename(alvo) }).first().click();
  await expect(campo).toBeVisible();
  await campo.fill('');
  await page.getByRole('option').first().click();
}

async function acrescentar(page: Page, alvo: string): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Add Folder to Workspace/ }).click();
  await escolherPasta(page, alvo);
  await expect(linhaArvore(page, path.basename(alvo))).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

/**
 * Devolve a suíte à pasta `demo`, sozinha.
 *
 * O espaço de trabalho é estado do SERVIDOR: deixar uma segunda raiz aberta
 * faria os testes de árvore de outros arquivos falharem por um motivo que eles
 * não mencionam. É a mesma nota que `pastas.spec.ts` carrega.
 */
test.afterEach(async ({ page }) => {
  const demo = await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    return ((await r.json()).data.recentes as string[]).find((c) => c.endsWith('/demo')) ?? null;
  });
  if (demo !== null) {
    await page.evaluate(
      (caminho) =>
        fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: caminho }),
        }),
      demo
    );
  }
});

test('com UMA raiz, a árvore é a de sempre — sem cabeçalho de raiz', async ({ page }) => {
  await expect(linhaArvore(page, 'utils.ts')).toBeVisible();
  await expect(page.locator('[data-raiz]')).toHaveCount(0);
  // O cabeçalho nomeia a pasta, como sempre nomeou.
  await expect(page.locator('[data-pasta-aberta]')).toHaveText('demo');
});

test('acrescentar uma pasta põe as DUAS na árvore', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);

  await expect(page.locator('[data-raiz]')).toHaveCount(2);
  await expect(linhaArvore(page, 'demo')).toBeVisible();
  await expect(linhaArvore(page, 'segunda')).toBeVisible();
  // A primeira continua aberta: acrescentar não fecha o que estava.
  await expect(linhaArvore(page, 'utils.ts')).toBeVisible();
});

test('a árvore da segunda raiz abre e fecha sozinha', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);

  await expect(linhaArvore(page, 'so-da-segunda.ts')).toBeVisible();
  await linhaArvore(page, 'segunda').click();
  await expect(linhaArvore(page, 'so-da-segunda.ts')).toHaveCount(0);
  // E a outra raiz não some junto.
  await expect(linhaArvore(page, 'utils.ts')).toBeVisible();
});

test('o Ctrl+P acha arquivo das DUAS pastas', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);

  await page.keyboard.press('Control+p');
  await entradaRapida(page).fill('so-da-seg');
  const caixa = page.getByRole('dialog', { name: 'Ir para arquivo' });
  await expect(caixa.getByRole('option').first()).toContainText('so-da-segunda.ts');
  // O nome da raiz aparece: dois `index.ts` de projetos diferentes seriam a
  // mesma linha sem ele.
  await expect(caixa.getByRole('option').first()).toContainText('segunda');

  await entradaRapida(page).press('Enter');
  await expect(page.locator('[data-tab="so-da-segunda.ts"]')).toBeVisible();
});

test('a busca cobre as DUAS pastas', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);

  await page.keyboard.press('Control+Shift+f');
  const campo = page.getByLabel('Pesquisar', { exact: true });
  await campo.fill('export const');
  await campo.press('Enter');

  // Uma de cada raiz: é o item inteiro do lado da busca.
  await expect(page.locator('[data-arquivo-busca="so-da-segunda.ts"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-arquivo-busca="utils.ts"]')).toBeVisible();
});

test('remover uma raiz deixa a outra', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);

  await linhaArvore(page, 'segunda').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Remover do espaço$/ }).click();

  await expect(page.locator('[data-raiz]')).toHaveCount(0, { timeout: 10_000 });
  await expect(linhaArvore(page, 'utils.ts')).toBeVisible();
  // Removida do espaço, NÃO do disco.
  expect(fs.existsSync(path.join(segunda, 'so-da-segunda.ts'))).toBe(true);
});

test('as duas raízes sobrevivem ao F5', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);

  await page.reload();
  await esperarIdePronta(page);
  await expect(page.locator('[data-raiz]')).toHaveCount(2);
  await expect(linhaArvore(page, 'so-da-segunda.ts')).toBeVisible();
});

test('Open Folder TROCA de projeto, em vez de somar', async ({ page }) => {
  const segunda = segundaPasta();
  await acrescentar(page, segunda);
  await expect(page.locator('[data-raiz]')).toHaveCount(2);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Open Folder/ }).click();
  await escolherPasta(page, segunda);

  await expect(page.locator('[data-raiz]')).toHaveCount(0);
  await expect(linhaArvore(page, 'so-da-segunda.ts')).toBeVisible();
  await expect(linhaArvore(page, 'utils.ts')).toHaveCount(0);
});
