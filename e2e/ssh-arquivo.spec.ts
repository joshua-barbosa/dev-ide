// Abrir, salvar e mexer no arquivo remoto (spec 053).
//
// Estes testes ESCREVEM — criam, renomeiam e apagam. Por isso rodam contra o
// `sshd` descartável da suíte, e nunca contra servidor do usuário.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import { aba, destrancarCofre, entradaRapida, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';

async function abrirServidor(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  await linhaArvore(page, CONEXAO_SSH).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('um clique num arquivo remoto ABRE ele no editor', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'aplicacao').click();
  await linhaArvore(page, 'README.md').click();

  await expect(aba(page, 'README.md')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
});

test('Ctrl+S grava NO SERVIDOR, e o conteúdo volta do servidor', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'aplicacao').click();
  await linhaArvore(page, 'src').click();
  await linhaArvore(page, 'main.ts').click();
  await expect(aba(page, 'main.ts')).toBeVisible();

  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nexport const gravadoRemotamente = true;');
  await expect(aba(page, 'main.ts')).toContainText('●');

  await page.keyboard.press('Control+s');
  await expect(aba(page, 'main.ts')).not.toContainText('●');

  // A prova de que foi para o SERVIDOR: fecha a aba, reabre, e o texto está lá.
  await page.reload();
  await esperarIdePronta(page);
  await abrirServidor(page);
  await linhaArvore(page, 'aplicacao').click();
  await linhaArvore(page, 'src').click();
  await linhaArvore(page, 'main.ts').click();
  await expect(page.locator('.monaco-editor')).toContainText('gravadoRemotamente');
});

test('criar arquivo pelo menu do botão direito, e ele abre já', async ({ page }) => {
  await abrirServidor(page);
  // Abre a pasta antes: criar dentro de uma fechada funciona e abre o arquivo,
  // mas a linha nova só existe na árvore depois que a pasta está aberta.
  await linhaArvore(page, 'logs').click();
  await linhaArvore(page, 'logs').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Novo arquivo…' }).click();
  await entradaRapida(page).fill('nasceu-aqui.txt');
  await page.keyboard.press('Enter');

  await expect(aba(page, 'nasceu-aqui.txt')).toBeVisible();
  await expect(linhaArvore(page, 'nasceu-aqui.txt')).toBeVisible();
});

test('renomear e apagar, com confirmação antes de apagar', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'logs').click();
  await linhaArvore(page, 'logs').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Novo arquivo…' }).click();
  await entradaRapida(page).fill('temporario.txt');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, 'temporario.txt')).toBeVisible();

  await linhaArvore(page, 'temporario.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renomear…' }).click();
  await entradaRapida(page).fill('renomeado.txt');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, 'renomeado.txt')).toBeVisible();
  await expect(linhaArvore(page, 'temporario.txt')).toHaveCount(0);

  await linhaArvore(page, 'renomeado.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Apagar' }).click();
  // Apagar no servidor não tem desfazer: pergunta antes.
  await expect(page.getByText('não tem desfazer')).toBeVisible();
  await page.getByRole('button', { name: 'Apagar' }).click();
  await expect(linhaArvore(page, 'renomeado.txt')).toHaveCount(0);
});

test('o menu de um ARQUIVO não oferece criar dentro dele', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'notas.txt').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Copiar caminho' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Baixar' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Nova pasta…' })).toHaveCount(0);
});

test('favoritar liga e desliga, e o nó Favorites acompanha', async ({ page }) => {
  await abrirServidor(page);
  await expect(linhaArvore(page, 'Favorites')).toContainText('0');

  await linhaArvore(page, 'aplicacao').hover();
  await linhaArvore(page, 'aplicacao').getByRole('button', { name: /Favoritar/ }).click();
  await expect(linhaArvore(page, 'Favorites')).toContainText('1');

  await linhaArvore(page, 'aplicacao').hover();
  await linhaArvore(page, 'aplicacao').getByRole('button', { name: /Favoritar/ }).click();
  await expect(linhaArvore(page, 'Favorites')).toContainText('0');
});

test('Executar no servidor MOSTRA o script antes, e a saída cai no Output', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'run.sh').hover();
  await linhaArvore(page, 'run.sh').getByRole('button', { name: /Executar/ }).click();

  // A prévia é a decisão D28 inteira: o conteúdo aparece antes de rodar.
  await expect(page.getByText('echo ola')).toBeVisible();
  await page.getByRole('button', { name: 'Executar' }).click();

  await expect(page.locator('[data-output]')).toBeVisible();
  await expect(page.locator('[data-output]')).toContainText('ola', { timeout: 30_000 });
});

test('desistir da prévia NÃO roda o script', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'run.sh').hover();
  await linhaArvore(page, 'run.sh').getByRole('button', { name: /Executar/ }).click();
  await expect(page.getByText('echo ola')).toBeVisible();

  await page.getByRole('button', { name: /cancelar/i }).click();
  // O painel `Output` já vinha aberto (é o padrão do rodapé); o que prova que
  // nada rodou é ele não ter a saída do script.
  await expect(page.locator('[data-output]')).not.toContainText('ola');
});

test('arquivo SEM bit de execução não oferece executar', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'notas.txt').hover();
  await expect(
    linhaArvore(page, 'notas.txt').getByRole('button', { name: /Executar/ })
  ).toHaveCount(0);
});
