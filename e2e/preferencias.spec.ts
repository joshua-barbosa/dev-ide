// Arquivo de preferências (spec 011).
//
// A afirmação que importa: editar o `config.json` DENTRO da IDE muda a IDE, sem
// recarregar a página. É o que faz este arquivo ser a tela de configurações em
// vez de um detalhe de implementação.
//
// Todo teste daqui devolve as preferências ao padrão no fim. A suíte compartilha
// um servidor, e preferência é estado global: deixar a fonte em 22 faria um
// teste de outro arquivo falhar por motivo que ele não menciona.
import { expect, test } from '@playwright/test';
import { editor, esperarEditorPronto, menu, textoDoEditor, esperarIdePronta } from './fixtures';

/**
 * Substitui todo o conteúdo do editor pelo texto dado.
 *
 * Parece mais complicado do que deveria, e o motivo é o **fechamento automático
 * do Monaco**. Ele insere o par de `{` e de `"` sozinho, e a edição sintética do
 * Playwright não dispara o "digitar por cima" que acontece com um teclado de
 * verdade. `{"editor.fontSize": 22}` chegava ao arquivo como
 * `{"editor.fontSize": 22}"}` — JSON inválido, e o teste falhava afirmando a
 * coisa certa pelo motivo errado.
 *
 * O que foi descartado no caminho: `keyboard.type` (mesmo problema) e a área de
 * transferência (`writeText` + `Ctrl+V` não chegou ao Monaco no Chrome sem
 * cabeça — o editor ficou intacto).
 *
 * O que funciona: inserir e **apagar o rastro**. Os fechadores automáticos ficam
 * todos à direita do cursor, empurrados para lá conforme o texto entrou — então
 * selecionar até o fim do documento e apagar limpa exatamente eles.
 */
async function escreverNoEditor(
  page: import('@playwright/test').Page,
  texto: string
): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(texto);
  await page.keyboard.press('Control+Shift+End');
  await page.keyboard.press('Delete');
}

/** Tamanho da fonte que o editor está de fato usando, em pixels. */
async function fonteDoEditor(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const linhas = document.querySelector('[data-editor] .view-lines');
    return linhas === null ? 0 : Number.parseFloat(getComputedStyle(linhas).fontSize);
  });
}

async function preferencias(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const r = await fetch('/api/prefs');
    return (await r.json()).data as Record<string, unknown>;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test.afterEach(async ({ page }) => {
  // Volta ao padrão pela rota, e não pelo editor: é o caminho mais curto e não
  // depende de nenhuma aba estar aberta.
  await page.evaluate(() =>
    fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'editor.fontSize': 13, 'editor.wordWrap': false }),
    })
  );
});

test('File → Preferences abre o config.json no editor', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Preferences' }).click();

  await expect(page.locator('[data-tab="config.json"]')).toBeVisible();
  // Vem com os padrões, e não vazio: o arquivo é criado se ainda não existir.
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);
});

test('editar a fonte no config.json muda o editor ao salvar, sem recarregar', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Preferences' }).click();
  await esperarEditorPronto(page);
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);

  const antes = await fonteDoEditor(page);
  expect(antes).toBe(13);

  await escreverNoEditor(page, '{"editor.fontSize": 22}');
  await expect.poll(() => textoDoEditor(page)).toBe('{"editor.fontSize": 22}');
  await page.keyboard.press('Control+s');

  // Sem F5 no meio: é a promessa da AC-14.
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(22);
});

test('JSON quebrado no config.json não derruba a IDE', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Preferences' }).click();
  await esperarEditorPronto(page);
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);

  // Sai do padrão ANTES de quebrar o arquivo. Sem este passo o teste passaria
  // mesmo que salvar não fizesse nada — 13 já era o valor.
  await escreverNoEditor(page, '{"editor.fontSize": 22}');
  await page.keyboard.press('Control+s');
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(22);

  await escreverNoEditor(page, 'isto não é json,,,');
  await page.keyboard.press('Control+s');

  // O editor continua de pé e as preferências voltam ao padrão — que é o sinal
  // honesto de "não entendi seu arquivo".
  await expect(editor(page).locator('.monaco-editor')).toBeVisible();
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(13);
});

test('Word Wrap persiste depois de recarregar a página', async ({ page }) => {
  expect((await preferencias(page))['editor.wordWrap']).toBe(false);

  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Word Wrap' }).click();

  await expect.poll(async () => (await preferencias(page))['editor.wordWrap']).toBe(true);

  // O ponto do item: a ação do Monaco alternaria e esqueceria.
  await page.reload();
  expect((await preferencias(page))['editor.wordWrap']).toBe(true);
});

test('a rota recusa preferência desconhecida', async ({ page }) => {
  const resposta = await page.evaluate(async () => {
    const r = await fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'algo.inventado': 1 }),
    });
    return (await r.json()) as { success: boolean; error: string | null };
  });

  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/desconhecida/);
});
