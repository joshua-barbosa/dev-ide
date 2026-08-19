// Save All, Auto Save e Revert File (spec 015).
//
// Estes testes gravam arquivos de verdade na pasta `demo` da suíte, e mexem em
// `editor.autoSave`, que é estado global do servidor. O `afterEach` devolve a
// preferência ao padrão — deixá-la ligada faria testes de outros arquivos
// salvarem sozinhos e falharem por motivo que não mencionam.
import { expect, test, type Page } from '@playwright/test';
import { aba, esperarEditorPronto, entradaRapida, linhaArvore, menu, textoDoEditor } from './fixtures';

async function autoSave(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/api/prefs');
    return (await r.json()).data['editor.autoSave'] as string;
  });
}

/** Cria um arquivo com nome único, para os testes não brigarem entre si. */
async function novoArquivoSalvo(page: Page, nome: string, conteudo: string): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText(conteudo);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await entradaRapida(page).fill(nome);
  await page.keyboard.press('Enter');
  await expect(aba(page, nome)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() =>
    fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'editor.autoSave': 'off' }),
    })
  );
});

test('Save All fica cinza sem aba suja', async ({ page }) => {
  await menu(page, 'File');
  await expect(page.getByRole('menuitem', { name: 'Save All' })).toBeDisabled();
});

test('Save All grava as abas com arquivo e avisa das que ainda não têm nome', async ({ page }) => {
  await novoArquivoSalvo(page, 'save-all-a.ts', 'const a = 1;');

  // Suja a aba já salva…
  await page.locator('[data-editor]').click();
  await page.keyboard.insertText('\n// mexido');
  await expect(aba(page, 'save-all-a.ts')).toHaveAttribute('data-tab-dirty', 'true');

  // …e abre uma sem título, que Save All não pode gravar sozinho.
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Save All' }).click();

  // A que tem arquivo foi gravada; a sem nome virou aviso, não uma fila de caixas.
  await expect(page.getByRole('dialog')).toContainText('ainda sem nome');
  await page.getByRole('button', { name: /ok|fechar/i }).click();
  await expect(aba(page, 'save-all-a.ts')).toHaveAttribute('data-tab-dirty', 'false');
});

test('Auto Save alterna pelo menu e mostra o modo no próprio item', async ({ page }) => {
  await menu(page, 'File');
  const item = page.getByRole('menuitem', { name: /Auto Save/ });
  // Um interruptor sem lâmpada não diz se está ligado.
  await expect(item).toContainText('off');
  await item.click();

  await expect.poll(() => autoSave(page)).toBe('afterDelay');
  await menu(page, 'File');
  await expect(page.getByRole('menuitem', { name: /Auto Save/ })).toContainText('afterDelay');
});

test('com Auto Save ligado, parar de digitar grava sozinho', async ({ page }) => {
  await novoArquivoSalvo(page, 'auto-save.ts', 'const inicial = 1;');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /Auto Save/ }).click();
  await expect.poll(() => autoSave(page)).toBe('afterDelay');

  await page.locator('[data-editor]').click();
  await page.keyboard.insertText('\nconst gravado_sozinho = 2;');
  await expect(aba(page, 'auto-save.ts')).toHaveAttribute('data-tab-dirty', 'true');

  // Sem tocar em Ctrl+S: o atraso padrão é 1 s.
  await expect(aba(page, 'auto-save.ts')).toHaveAttribute('data-tab-dirty', 'false', {
    timeout: 10_000,
  });
});

test('Auto Save NUNCA grava aba sem título', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /Auto Save/ }).click();
  await expect.poll(() => autoSave(page)).toBe('afterDelay');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText('nao pode ir para disco sozinho');

  // Continua suja: não há como inventar um nome, e perguntar no meio da
  // digitação seria o oposto de automático.
  await page.waitForTimeout(3_000);
  await expect(page.locator('[data-tab="untitled-1"]')).toHaveAttribute('data-tab-dirty', 'true');
});

test('Revert File volta ao disco, depois de confirmar', async ({ page }) => {
  await novoArquivoSalvo(page, 'revert.ts', 'const original = 1;');

  await page.locator('[data-editor]').click();
  await page.keyboard.insertText('\nconst vai_sumir = 2;');
  await expect.poll(() => textoDoEditor(page)).toMatch(/vai_sumir/);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Revert File' }).click();

  // Destrutivo: confirma antes, como fechar aba suja já fazia.
  await page.getByRole('dialog').getByRole('button', { name: /reverter/i }).click();

  await expect.poll(() => textoDoEditor(page)).not.toMatch(/vai_sumir/);
  await expect.poll(() => textoDoEditor(page)).toMatch(/const original = 1;/);
  await expect(aba(page, 'revert.ts')).toHaveAttribute('data-tab-dirty', 'false');
});

test('Revert numa aba sem título explica em vez de não fazer nada', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'Revert File' }).click();

  await expect(page.getByRole('dialog')).toContainText(/não foi salv/i);
});

test('os arquivos criados aparecem na árvore', async ({ page }) => {
  // Fecha o ciclo: gravar de verdade, e a lateral saber.
  await expect(linhaArvore(page, 'save-all-a.ts')).toBeVisible();
});
