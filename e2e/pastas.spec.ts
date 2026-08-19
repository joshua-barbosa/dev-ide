// Abrir pasta e pastas recentes (spec 012).
//
// A afirmação central: a IDE deixou de estar presa a `projects/`. O usuário
// disse a frase que motivou o item — "até agora eu estou em um chamado
// meu-jogo-3d e não consigo sair dele".
//
// Estes testes ABREM outra pasta, que é estado global do servidor. Todo um
// devolve a `demo` no fim, senão os testes de árvore de outros arquivos
// falhariam por motivo que eles não mencionam.
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, linhaArvore, menu } from './fixtures';

/** A pasta aberta agora, lida do próprio painel. */
async function pastaAberta(page: Page): Promise<string> {
  return (await page.locator('[data-pasta-aberta]').getAttribute('data-pasta-aberta')) ?? '';
}

async function abrirPelaPaleta(page: Page, item: string): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: item }).click();
}

/** Escolhe uma opção da entrada rápida pelo rótulo. */
async function escolher(page: Page, rotulo: string | RegExp): Promise<void> {
  await expect(entradaRapida(page)).toBeVisible();
  await page.getByRole('option', { name: rotulo }).first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  // Devolve a suíte à pasta `demo`, seja qual for o estado deixado pelo teste.
  const demo = await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    return ((await r.json()).data.recentes as string[]).find((c) => c.endsWith('/demo')) ?? null;
  });
  if (demo !== null) {
    await page.evaluate(
      (path) =>
        fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        }),
      demo
    );
  }
});

test('a suíte começa na pasta demo, com a árvore dela', async ({ page }) => {
  await expect.poll(() => pastaAberta(page)).toMatch(/\/projects\/demo$/);
  await expect(linhaArvore(page, 'utils.ts')).toBeVisible();
});

test('Open Folder navega até a pasta pai e abre outra pasta', async ({ page }) => {
  const antes = await pastaAberta(page);

  await abrirPelaPaleta(page, 'Open Folder…');
  // Sobe de `demo` para `projects` e abre ali.
  await escolher(page, '..');
  await escolher(page, 'Abrir esta pasta');

  await expect.poll(() => pastaAberta(page)).toMatch(/\/projects$/);
  expect(await pastaAberta(page)).not.toBe(antes);
  // A árvore passou a ser a de `projects`, que contém a pasta `demo`.
  await expect(linhaArvore(page, 'demo')).toBeVisible();
});

test('cancelar a navegação mantém a pasta anterior', async ({ page }) => {
  const antes = await pastaAberta(page);

  await abrirPelaPaleta(page, 'Open Folder…');
  await expect(entradaRapida(page)).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(entradaRapida(page)).toHaveCount(0);
  expect(await pastaAberta(page)).toBe(antes);
});

test('Open Recent traz de volta a pasta anterior', async ({ page }) => {
  // Sai de `demo` para ter mais de uma pasta no histórico.
  await abrirPelaPaleta(page, 'Open Folder…');
  await escolher(page, '..');
  await escolher(page, 'Abrir esta pasta');
  await expect.poll(() => pastaAberta(page)).toMatch(/\/projects$/);

  await abrirPelaPaleta(page, 'Open Recent');
  // O nome acessível da opção junta rótulo e caminho, então casar por trecho é
  // o que funciona — e "demo" só aparece na opção certa.
  await escolher(page, /demo/);

  await expect.poll(() => pastaAberta(page)).toMatch(/\/projects\/demo$/);
});

test('a pasta aberta sobrevive a recarregar a página', async ({ page }) => {
  await abrirPelaPaleta(page, 'Open Folder…');
  await escolher(page, '..');
  await escolher(page, 'Abrir esta pasta');
  await expect.poll(() => pastaAberta(page)).toMatch(/\/projects$/);

  await page.reload();

  // Antes da spec 012 a IDE voltava ao primeiro projeto por ordem alfabética.
  await expect.poll(() => pastaAberta(page)).toMatch(/\/projects$/);
});

test('criar arquivo grava na pasta aberta', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();

  await entradaRapida(page).fill('criado-pelo-teste.ts');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-tab="criado-pelo-teste.ts"]')).toBeVisible();
  await expect(linhaArvore(page, 'criado-pelo-teste.ts')).toBeVisible();
});

test('a rota recusa abrir uma pasta que não existe', async ({ page }) => {
  const resposta = await page.evaluate(async () => {
    const r = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/isto/nao/existe/mesmo' }),
    });
    return (await r.json()) as { success: boolean; error: string | null };
  });

  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/não encontrada/);
});
