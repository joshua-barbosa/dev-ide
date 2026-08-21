// Snippets de código (spec 019).
//
// A afirmação que só passou a ser possível depois da spec 010: **marcador
// espelhado**. O backlog dava isso como impossível — exigia multi-cursor, e a
// `textarea` de então tinha um cursor por definição do HTML. O Monaco resolve.
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, esperarEditorPronto, menu, textoDoEditor, esperarIdePronta } from './fixtures';

async function limparSnippets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const lista = (await (await fetch('/api/snippets')).json()).data as { id: string }[];
    for (const s of lista) await fetch(`/api/snippets/${s.id}`, { method: 'DELETE' });
  });
}

async function criarSnippet(
  page: Page,
  prefixo: string,
  corpo: string,
  linguagem = '*'
): Promise<void> {
  await page.evaluate(
    (dados) =>
      fetch('/api/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      }),
    { nome: prefixo, prefixo, corpo, linguagem }
  );
  // A lista da interface é carregada na montagem; recarrega para vê-la.
  await page.reload();
}

async function abrirCaixa(page: Page): Promise<void> {
  await menu(page, 'Edit');
  await page.getByRole('menuitem', { name: /Snippets/ }).click();
  await expect(entradaRapida(page)).toBeVisible();
}

async function novoArquivo(page: Page): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
  await limparSnippets(page);
});

test.afterEach(async ({ page }) => {
  await limparSnippets(page);
});

test('a caixa de snippets abre pelo menu Edit', async ({ page }) => {
  await abrirCaixa(page);
  await expect(page.getByRole('option', { name: /Salvar um snippet novo/ })).toBeVisible();
});

test('salvar um snippet pela IDE e vê-lo na lista', async ({ page }) => {
  await novoArquivo(page);
  await abrirCaixa(page);
  await page.getByRole('option', { name: /Salvar um snippet novo/ }).click();

  await entradaRapida(page).fill('meulog');
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill('console.log($1);');
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /Todas as linguagens/ }).click();

  await abrirCaixa(page);
  await expect(page.getByRole('option', { name: /meulog/ })).toBeVisible();
});

test('inserir pela caixa põe o corpo no editor', async ({ page }) => {
  await criarSnippet(page, 'cab', '// Arquivo: $1\n// Autor: $2');
  await novoArquivo(page);

  await abrirCaixa(page);
  await page.getByRole('option', { name: /^cab/ }).click();

  await expect.poll(() => textoDoEditor(page)).toMatch(/\/\/ Arquivo:/);
  await expect.poll(() => textoDoEditor(page)).toMatch(/\/\/ Autor:/);
  // Os marcadores não podem entrar como texto literal.
  await expect.poll(() => textoDoEditor(page)).not.toMatch(/\$1/);
});

test('MARCADOR ESPELHADO: o mesmo $1 nos dois lugares, editado junto', async ({ page }) => {
  // É a afirmação que a spec 010 destravou. Antes dela o backlog registrava
  // isto como impossível: exigia multi-cursor, e a `textarea` tem um cursor por
  // definição do HTML.
  await criarSnippet(page, 'par', 'const $1 = 1; // nome: $1');
  await novoArquivo(page);

  await abrirCaixa(page);
  await page.getByRole('option', { name: /^par/ }).click();

  await page.keyboard.type('total');
  await expect
    .poll(() => textoDoEditor(page))
    .toMatch(/const total = 1; \/\/ nome: total/);
});

test('Tab pula para o marcador seguinte', async ({ page }) => {
  await criarSnippet(page, 'dois', 'a=$1;b=$2;');
  await novoArquivo(page);

  await abrirCaixa(page);
  await page.getByRole('option', { name: /^dois/ }).click();

  await page.keyboard.type('um');
  await page.keyboard.press('Tab');
  await page.keyboard.type('dois');

  await expect.poll(() => textoDoEditor(page)).toMatch(/a=um;b=dois;/);
});

test('digitar o prefixo sugere o snippet na conclusão', async ({ page }) => {
  await criarSnippet(page, 'zzlog', 'console.log($1);');
  await novoArquivo(page);

  await page.keyboard.type('zzlo');
  // A lista de conclusão é do Monaco, e vive dentro da área do editor.
  await expect(page.locator('.suggest-widget')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.suggest-widget')).toContainText('zzlog');
});

test('prefixo repetido na mesma linguagem é recusado', async ({ page }) => {
  const resposta = await page.evaluate(async () => {
    const criar = () =>
      fetch('/api/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixo: 'rep', corpo: 'x', linguagem: 'typescript' }),
      }).then((r) => r.json());
    await criar();
    return (await criar()) as { success: boolean; error: string | null };
  });
  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/Já existe/);
});

test('prefixo com espaço é recusado — ele nunca dispararia', async ({ page }) => {
  const resposta = await page.evaluate(async () =>
    fetch('/api/snippets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixo: 'meu log', corpo: 'x' }),
    }).then((r) => r.json() as Promise<{ success: boolean; error: string | null }>)
  );
  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/espaços/);
});
