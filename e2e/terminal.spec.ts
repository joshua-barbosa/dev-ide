// Terminal integrado.
//
// O que se prova aqui é o caminho completo — menu, WebSocket, PTY e emulador —
// com um shell. O cliente de banco não entra: exigiria um servidor MySQL ou
// PostgreSQL de verdade, e a garantia que importa nele (a senha nunca em `argv`)
// é provada sem rede em `comando.test.ts`.
import { expect, test } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import { expandir, garantirCofreAberto, linhaArvore, menu, painelLateral } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('o menu Terminal deixou de ser promessa', async ({ page }) => {
  await menu(page, 'Terminal');
  await expect(page.getByRole('menuitem', { name: 'New Terminal' })).toBeEnabled();
});

test('abrir terminal roda o shell e responde ao que é digitado', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();

  const terminal = page.locator('[data-terminal="shell"]');
  await expect(terminal).toBeVisible();
  await expect(page.locator('[data-tab="Terminal"]')).toBeVisible();

  // O shell precisa estar de pé antes de receber comando.
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 15_000 });

  await terminal.click();
  await page.keyboard.type('echo PONTA-A-PONTA-OK');
  await page.keyboard.press('Enter');

  // Se chegou aqui, o caminho inteiro funcionou: tecla → WebSocket → PTY →
  // shell → sequências de escape → emulador.
  await expect(terminal).toContainText('PONTA-A-PONTA-OK', { timeout: 15_000 });
});

test('é um terminal de verdade, não um cano', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();

  const terminal = page.locator('[data-terminal="shell"]');
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 15_000 });

  await terminal.click();
  await page.keyboard.type('tty');
  await page.keyboard.press('Enter');

  // Num cano isto responderia "not a tty", e aí não haveria cor, edição de
  // linha nem Ctrl+C.
  await expect(terminal).toContainText(/\/dev\/pts\/\d+/, { timeout: 15_000 });
});

test('fechar a aba encerra a sessão', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await expect(page.locator('[data-terminal="shell"]')).toBeVisible();

  await page.locator('[data-tab="Terminal"]').locator('button').click();
  await expect(page.locator('[data-terminal="shell"]')).toHaveCount(0);
});

test('a ação de terminal não aparece em driver sem cliente', async ({ page }) => {
  // SQLite é um arquivo: não existe `sqlite` a que se conectar com credencial.
  await painelLateral(page, 'Database').click();
  await garantirCofreAberto(page, SENHA_MESTRA);
  await expandir(page, 'ACME', 'Bancos');

  const linha = linhaArvore(page, CONEXAO);
  await linha.hover();
  await expect(linha.getByRole('button', { name: 'Excluir conexão' })).toBeVisible();
  await expect(linha.getByRole('button', { name: 'Abrir no terminal' })).toHaveCount(0);
});
