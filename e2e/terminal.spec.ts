// Terminal integrado.
//
// O que se prova aqui é o caminho completo — menu, WebSocket, PTY e emulador —
// com um shell. O cliente de banco não entra: exigiria um servidor MySQL ou
// PostgreSQL de verdade, e a garantia que importa nele (a senha nunca em `argv`)
// é provada sem rede em `comando.test.ts`.
//
// **Desde a spec 014 o terminal de shell mora no PAINEL INFERIOR**, e não como
// aba do editor (decisão D6). O de conexão continua sendo aba — saída longa de
// query merece tela cheia. A gestão do painel (lista, `+`, lixeira) é testada em
// `painel.spec.ts`; aqui fica o caminho até o PTY.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import {
  esperarIdePronta, expandir, fecharTodosOsTerminais, garantirCofreAberto, linhaArvore, menu,
  painelLateral,
} from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test.afterEach(async ({ page }) => {
  await fecharTodosOsTerminais(page);
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
  await expect(page.locator('[data-terminal-item="Terminal 1"]')).toBeVisible();

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

test('fechar o terminal encerra a sessão', async ({ page }) => {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await expect(page.locator('[data-terminal="shell"]')).toBeVisible();

  // A lixeira do painel substituiu o X da aba na spec 014.
  await page.getByRole('button', { name: 'Fechar terminal' }).click();
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

test('mexer nas abas do editor não perturba o terminal do painel', async ({ page }) => {
  // Regressão real, e a razão de este teste existir: a aba de terminal era
  // renderizada condicionalmente, então sair dela DESMONTAVA o componente —
  // matando o processo e jogando fora o buffer.
  //
  // Desde a spec 014 o terminal mora no painel, então o ângulo mudou: o que
  // precisa não perturbá-lo é trocar de aba NO EDITOR, que é outra parte da
  // tela. Alternar entre dois terminais é coberto em `painel.spec.ts`.
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();

  const terminal = page.locator('[data-terminal="shell"]');
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 15_000 });

  await terminal.click();
  await page.keyboard.type('echo MARCA-DA-SESSAO');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('MARCA-DA-SESSAO', { timeout: 15_000 });

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await expect(page.locator('[data-tab="untitled-1"]')).toBeVisible();
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await page.locator('[data-tab="untitled-1"]').click();

  // O que estava na tela precisa continuar lá, e o shell precisa ser o MESMO.
  await expect(terminal).toContainText('MARCA-DA-SESSAO');
  await terminal.click();
  await page.keyboard.type('echo AINDA-VIVO');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('AINDA-VIVO', { timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// Copiar e colar (03/09/2026)
// ---------------------------------------------------------------------------

/**
 * Abre um terminal novo e o FECHA no fim do teste.
 *
 * A limpeza não é zelo: os terminais sobrevivem ao teste e ao F5, e o vizinho
 * que pega `[data-terminal]` com `.first()` passa a olhar para o terminal
 * errado. Quem sujou é quem limpa.
 */
async function comTerminal(page: Page): Promise<void> {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();
  await expect(page.locator('[data-terminal]').first()).toBeVisible({ timeout: 20_000 });
}

/** O que está escrito no terminal, como texto. */
async function textoDoTerminalAgora(page: Page): Promise<string> {
  return page.locator('.xterm-rows').first().innerText();
}

test('Ctrl+Shift+C copia a seleção do terminal', async ({ page, context }) => {
  // Relato dele: "não estou conseguindo copiar texto do terminal e uso bastante".
  // O emulador desenha o texto ele mesmo, e a seleção NÃO é do DOM — então o
  // Ctrl+C do navegador não tinha o que copiar.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await comTerminal(page);
  await page.evaluate(() => navigator.clipboard.writeText('LIXO'));

  await page.locator('.xterm-screen').first().click();
  await page.keyboard.type('echo braytech-copiar-ok');
  await page.keyboard.press('Enter');
  await expect.poll(() => textoDoTerminalAgora(page), { timeout: 20_000 })
    .toContain('braytech-copiar-ok');

  // Seleciona com o mouse, que é como ele faz: arrasta sobre a linha.
  const tela = page.locator('.xterm-screen').first();
  const caixa = await tela.boundingBox();
  if (caixa !== null) {
    await page.mouse.move(caixa.x + 4, caixa.y + 6);
    await page.mouse.down();
    await page.mouse.move(caixa.x + caixa.width - 8, caixa.y + caixa.height - 8, { steps: 8 });
    await page.mouse.up();
  }
  await page.keyboard.press('Control+Shift+C');

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
    .toContain('braytech-copiar-ok');

});

test('o menu de botão direito oferece Copiar e Colar', async ({ page }) => {
  // Atalho não se descobre: quem nunca usou Ctrl+Shift+C num terminal não vai
  // adivinhá-lo. O menu é o caminho que se acha.
  await comTerminal(page);
  await page.locator('[data-terminal]').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^Copiar/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Colar/ })).toBeVisible();
  await page.keyboard.press('Escape');

});
