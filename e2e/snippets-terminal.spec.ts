// Os snippets do terminal (spec 058).
//
// Ele mesmo notou a sobreposição com o comando salvo que saiu na spec 039 — e a
// diferença é que num terminal não existe a pasta `Query` que tornou aquele
// desnecessário.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import {
  destrancarCofre, entradaRapida, esperarIdePronta, expandir, linhaArvore, painelLateral,
} from './fixtures';

/**
 * O terminal de uma CONEXÃO, que é onde a barra vive.
 *
 * `Terminal → New Terminal` abre no painel de baixo, que é outra coisa: ali não
 * há conexão a que amarrar snippet nenhum.
 */
async function abrirTerminal(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.hover();
  await linha.getByRole('button', { name: /terminal/i }).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(page.locator('[data-barra-do-terminal]')).toBeVisible({ timeout: 30_000 });
}

/**
 * Cria um snippet. A lista fica ABERTA no fim — é o que acontece de verdade, e
 * é bom que aconteça: quem acabou de criar quer ver o que criou.
 */
async function criarSnippet(page: Page, nome: string, comando: string): Promise<void> {
  const lista = page.locator('[data-lista-de-snippets]');
  if (!(await lista.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Snippets' }).click();
  }
  await page.getByRole('button', { name: 'Novo snippet' }).click();
  await entradaRapida(page).fill(nome);
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill(comando);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a aba de terminal tem barra, e a barra tem Snippets', async ({ page }) => {
  await abrirTerminal(page);
  await expect(page.getByRole('button', { name: 'Snippets' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconectar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicar terminal' })).toBeVisible();
});

test('criar um snippet, e ele aparece na lista', async ({ page }) => {
  await abrirTerminal(page);
  await criarSnippet(page, 'Disk Usage', 'du -h -d 1 | sort -h');

  await expect(page.locator('[data-snippet="Disk Usage"]')).toBeVisible();
  await expect(page.locator('[data-snippet="Disk Usage"]')).toContainText('du -h -d 1');
});

test('rodar o snippet MANDA o comando para o terminal', async ({ page }) => {
  await abrirTerminal(page);
  const terminal = page.locator('[data-terminal]').first();
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 20_000 });

  await criarSnippet(page, 'Oi', 'echo VEIO-DO-SNIPPET');
  await page.getByRole('button', { name: 'Rodar Oi' }).click();

  // Foi como DIGITAÇÃO: o comando aparece na tela e a saída vem depois.
  await expect(terminal).toContainText('VEIO-DO-SNIPPET', { timeout: 20_000 });
});

test('o snippet sobrevive ao F5 — ele é do trabalho, não da aba', async ({ page }) => {
  await abrirTerminal(page);
  await criarSnippet(page, 'Persistente', 'pwd');

  await page.reload();
  await esperarIdePronta(page);
  // A ABA de terminal não volta do F5 (é item do backlog); o snippet volta,
  // porque ele mora em disco e não na aba. Reabrir o terminal é o que prova.
  await abrirTerminal(page);
  await page.getByRole('button', { name: 'Snippets' }).click();
  await expect(page.locator('[data-snippet="Persistente"]')).toBeVisible();
});

test('apagar pergunta antes, e some da lista', async ({ page }) => {
  await abrirTerminal(page);
  await criarSnippet(page, 'Temporario', 'ls');

  await page.getByRole('button', { name: 'Apagar Temporario' }).click();
  await expect(page.getByText('Apagar o snippet "Temporario"?')).toBeVisible();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await expect(page.locator('[data-snippet="Temporario"]')).toHaveCount(0);
});

test('editar substitui NO LUGAR, e não manda para o fim', async ({ page }) => {
  await abrirTerminal(page);
  await criarSnippet(page, 'Primeiro', 'ls');
  await criarSnippet(page, 'Segundo', 'pwd');

  await page.getByRole('button', { name: 'Editar Primeiro' }).click();
  await entradaRapida(page).fill('Primeiro');
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill('ls -la');
  await page.keyboard.press('Enter');

  // A suíte compartilha a conexão, e os testes anteriores deixaram snippets:
  // o que se afirma é a ORDEM RELATIVA dos dois, não a lista inteira. Isolar
  // por dado, e não por ordem — a lição da spec 044.
  const nomes = await page.locator('[data-snippet]').evaluateAll((ns) =>
    ns.map((n) => n.getAttribute('data-snippet'))
  );
  expect(nomes.indexOf('Primeiro')).toBeLessThan(nomes.indexOf('Segundo'));
  await expect(page.locator('[data-snippet="Primeiro"]')).toContainText('ls -la');
});
