// Temas embutidos, tema do usuário e seguir o sistema (T012, T013, T014).
//
// A escolha foi dele: *"embutidos + tema seu no config.json"*, com todos os
// conjuntos que eu ofereci. Aqui se prova o que a tela faz — a resolução de
// paleta é testada sem navegador (`shared/__tests__/temas.test.ts`).
import { expect, test, type Page } from '@playwright/test';
import { esperarIdePronta, menu } from './fixtures';

/** A cor de fundo do editor, que é a que muda mais visivelmente com o tema. */
async function fundoDoEditor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-editor]');
    return el === null ? '' : getComputedStyle(el).backgroundColor;
  });
}

async function escolherTema(page: Page, rotulo: string | RegExp): Promise<void> {
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Appearance' }).click();
  await page.getByRole('option', { name: rotulo }).first().click();
}

/** Escreve no `config.json` sem passar pelo editor — é o caminho curto. */
async function gravarConfig(page: Page, conteudo: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (dados) => {
    const r = await fetch('/api/prefs/file', { method: 'POST' });
    const { path } = (await r.json()).data as { path: string };
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: JSON.stringify(dados, null, 2) }),
    });
  }, conteudo);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test.afterEach(async ({ page }) => {
  // A suíte compartilha um servidor, e tema é estado global: deixar o Dracula
  // ligado faria um teste de outro arquivo falhar sem mencionar o motivo.
  await gravarConfig(page, { 'editor.fontSize': 13, 'workbench.theme': 'escuro' });
});

test('o seletor oferece os nove temas embutidos', async ({ page }) => {
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Appearance' }).click();

  for (const nome of [
    'Escuro', 'Claro', 'One Dark', 'Dracula', 'Solarized Dark', 'Solarized Light',
    'Nord', 'GitHub Light', 'Alto contraste',
  ]) {
    // Sem `exact`: a opção atual traz o detalhe "atual" ao lado do rótulo.
    await expect(page.getByRole('option', { name: nome }).first()).toBeVisible();
  }
});

test('escolher um tema repinta a IDE na hora', async ({ page }) => {
  const antes = await fundoDoEditor(page);
  await escolherTema(page, 'Dracula');
  await expect.poll(() => fundoDoEditor(page)).not.toBe(antes);
  // `#282a36` do Dracula.
  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(40, 42, 54)');
});

test('o alto contraste é preto de verdade (T014)', async ({ page }) => {
  await escolherTema(page, 'Alto contraste');
  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(0, 0, 0)');
});

test('um tema DELE no config.json aparece no seletor e pinta a tela', async ({ page }) => {
  await gravarConfig(page, {
    'workbench.theme': 'meu-escuro',
    'workbench.themes': {
      'meu-escuro': { base: 'nord', cores: { bgEditor: '#101014' } },
    },
  });
  await page.reload();
  await esperarIdePronta(page);

  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(16, 16, 20)');

  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Appearance' }).click();
  const dele = page.getByRole('option', { name: /meu-escuro/ });
  await expect(dele).toBeVisible();
  // Marcado como dele: sem isso não haveria como distinguir de um embutido.
  await expect(dele).toContainText('atual');
});

test('o tema dele HERDA o que não declarou', async ({ page }) => {
  await gravarConfig(page, {
    'workbench.theme': 'so-o-fundo',
    'workbench.themes': { 'so-o-fundo': { base: 'dracula', cores: { bgEditor: '#010203' } } },
  });
  await page.reload();
  await esperarIdePronta(page);

  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(1, 2, 3)');
  // O rodapé veio do Dracula, e não do escuro: `#282a36`.
  const moldura = await page.evaluate(() => {
    const el = document.querySelector('footer');
    return el === null ? '' : getComputedStyle(el).backgroundColor;
  });
  expect(moldura).toBe('rgb(40, 42, 54)');
});

test('nome de tema que não existe cai no escuro, sem derrubar a IDE', async ({ page }) => {
  await gravarConfig(page, { 'workbench.theme': 'fantasma' });
  await page.reload();
  await esperarIdePronta(page);

  // `#16171c` do escuro.
  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(22, 23, 28)');
  // E a IDE está de pé: a árvore respondeu.
  await expect(page.locator('[data-tree-row]').first()).toBeVisible();
});

test('seguir o sistema usa os DOIS temas que ele indicou (T013)', async ({ page }) => {
  await gravarConfig(page, {
    'workbench.followSystem': true,
    'workbench.themeDark': 'nord',
    'workbench.themeLight': 'github-claro',
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await esperarIdePronta(page);
  // `#2e3440` do Nord.
  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(46, 52, 64)');

  // Sem F5: o sistema mudando é evento, e a IDE reage.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(255, 255, 255)');
});

test('sem seguir o sistema, a escolha manual continua mandando', async ({ page }) => {
  await gravarConfig(page, { 'workbench.theme': 'nord', 'workbench.followSystem': false });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await esperarIdePronta(page);

  await expect.poll(() => fundoDoEditor(page)).toBe('rgb(46, 52, 64)');
});
