// O menu de botão direito da árvore (T043, T045 — spec 073).
//
// A nota dele foi exata: *"Renomear, excluir, duplicar, copiar caminho. Com F2
// e Delete com confirmação."* e *"'Novo arquivo aqui' no menu da pasta."*
//
// O que estes testes provam além do óbvio: **as abas seguem o disco.** Renomear
// um arquivo aberto tem de levar a aba junto — senão `Ctrl+S` recria o arquivo
// com o nome antigo e desfaz o renomear em silêncio, que é o pior desfecho
// possível.
import { expect, test, type Page } from '@playwright/test';
import {
  abrirArquivo, confirmar, entradaRapida, esperarIdePronta, linhaArvore,
} from './fixtures';

/** Abre o menu de contexto de um item da árvore. */
async function menuDe(page: Page, nome: string): Promise<void> {
  await linhaArvore(page, nome).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
}

/**
 * Abre a pasta `sub` e cria um arquivo dentro dela pelo menu.
 *
 * A pasta precisa estar EXPANDIDA: o arquivo novo nasce dentro dela, e numa
 * pasta fechada ele existiria em disco sem aparecer na árvore.
 */
async function criarEmSub(page: Page, nome: string): Promise<void> {
  await linhaArvore(page, 'sub').click();
  await expect(linhaArvore(page, 'dentro.txt')).toBeVisible();
  await menuDe(page, 'sub');
  await item(page, /^Novo arquivo aqui$/).click();
  await responder(page, `sub/${nome}`);
}

const item = (page: Page, nome: string | RegExp) =>
  page.getByRole('menuitem', { name: nome });

/** Escreve na entrada rápida e confirma. */
async function responder(page: Page, texto: string): Promise<void> {
  const campo = entradaRapida(page);
  await expect(campo).toBeVisible();
  await campo.fill(texto);
  await campo.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o menu de um ARQUIVO não oferece "novo arquivo aqui"', async ({ page }) => {
  await menuDe(page, 'utils.ts');
  // Ele existiria como "ao lado deste", que é o que o botão do cabeçalho já
  // faz — e um item a mais para ler toda vez.
  await expect(item(page, /^Novo arquivo aqui$/)).toHaveCount(0);
  await expect(item(page, /^Renomear/)).toBeVisible();
  await expect(item(page, /^Duplicar$/)).toBeVisible();
  await expect(item(page, /^Copiar caminho$/)).toBeVisible();
  await expect(item(page, /^Excluir/)).toBeVisible();
});

test('o menu de uma PASTA oferece criar dentro dela (T045)', async ({ page }) => {
  await menuDe(page, 'sub');
  await expect(item(page, /^Novo arquivo aqui$/)).toBeVisible();
  await expect(item(page, /^Nova pasta aqui$/)).toBeVisible();
});

test('"novo arquivo aqui" já vem com a pasta escrita no campo', async ({ page }) => {
  await linhaArvore(page, 'sub').click();
  await menuDe(page, 'sub');
  await item(page, /^Novo arquivo aqui$/).click();
  // O prefixo entra como TEXTO, e não como enfeite: assim é visível e editável.
  await expect(entradaRapida(page)).toHaveValue('sub/');

  await responder(page, 'sub/dentro-do-menu.ts');
  await expect(page.locator('[data-tab="dentro-do-menu.ts"]')).toBeVisible();
  await expect(linhaArvore(page, 'dentro-do-menu.ts')).toBeVisible();
});

test('duplicar cria a cópia ao lado, sem tocar no original', async ({ page }) => {
  await menuDe(page, 'lib.ts');
  await item(page, /^Duplicar$/).click();

  await expect(linhaArvore(page, 'lib copy.ts')).toBeVisible();
  await expect(linhaArvore(page, 'lib.ts')).toBeVisible();
});

test('renomear leva a ABA ABERTA junto', async ({ page }) => {
  await abrirArquivo(page, 'usa-lib.ts');
  await menuDe(page, 'usa-lib.ts');
  await item(page, /^Renomear/).click();

  // O campo abre com o nome atual: renomear costuma ser trocar uma letra.
  await expect(entradaRapida(page)).toHaveValue('usa-lib.ts');
  await responder(page, 'usa-a-lib.ts');

  await expect(linhaArvore(page, 'usa-a-lib.ts')).toBeVisible();
  // A aba TEM de acompanhar: senão Ctrl+S recria o arquivo com o nome antigo.
  await expect(page.locator('[data-tab="usa-a-lib.ts"]')).toBeVisible();
  await expect(page.locator('[data-tab="usa-lib.ts"]')).toHaveCount(0);
});

test('renomear por cima de um arquivo existente é recusado, sem perder o que foi digitado', async ({ page }) => {
  await menuDe(page, 'ignorado.txt');
  await item(page, /^Renomear/).click();
  await responder(page, 'utils.ts');

  // A entrada rápida continua aberta, com o erro e com o texto de volta.
  // O nome no seletor não é enfeite: a caixa da entrada rápida vive DENTRO de
  // um `Dialog`, então `getByRole('dialog')` sozinho casa os dois.
  await expect(entradaRapida(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Renomear' })).toContainText('já existe');
  await expect(entradaRapida(page)).toHaveValue('utils.ts');
  await entradaRapida(page).press('Escape');
  await expect(linhaArvore(page, 'ignorado.txt')).toBeVisible();
});

test('excluir PERGUNTA antes, e cancelar não apaga nada', async ({ page }) => {
  await menuDe(page, 'ignorado.txt');
  await item(page, /^Excluir/).click();

  await expect(page.getByRole('dialog')).toContainText('não tem desfazer');
  await confirmar(page, false);
  await expect(linhaArvore(page, 'ignorado.txt')).toBeVisible();
});

test('excluir fecha a aba do arquivo apagado', async ({ page }) => {
  await criarEmSub(page, 'para-apagar.ts');
  await expect(page.locator('[data-tab="para-apagar.ts"]')).toBeVisible();

  await menuDe(page, 'para-apagar.ts');
  await item(page, /^Excluir/).click();
  await confirmar(page, true);

  await expect(linhaArvore(page, 'para-apagar.ts')).toHaveCount(0);
  await expect(page.locator('[data-tab="para-apagar.ts"]')).toHaveCount(0);
});

test('F2 renomeia o item selecionado', async ({ page }) => {
  await criarEmSub(page, 'pela-tecla.ts');

  await linhaArvore(page, 'pela-tecla.ts').click();
  await page.keyboard.press('F2');
  await expect(entradaRapida(page)).toHaveValue('pela-tecla.ts');
  await responder(page, 'renomeada-pela-tecla.ts');
  await expect(linhaArvore(page, 'renomeada-pela-tecla.ts')).toBeVisible();
});

test('Delete pede confirmação, como o menu', async ({ page }) => {
  await criarEmSub(page, 'pela-tecla-delete.ts');

  await linhaArvore(page, 'pela-tecla-delete.ts').click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog')).toContainText('não tem desfazer');
  await confirmar(page, true);
  await expect(linhaArvore(page, 'pela-tecla-delete.ts')).toHaveCount(0);
});
