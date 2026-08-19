// As abas do editor sobrevivem ao F5 (spec 030).
//
// A spec 023 provou o mesmo para os terminais do painel. O que muda aqui é o
// que NÃO volta, e é onde estão as decisões: aba sem título, edição não salva e
// abas de outro projeto.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { PASTA_DEMO } from './global-setup';
import {
  abrirArquivo, aba, editor, entradaRapida, esperarEditorPronto, menu, textoDoEditor,
} from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('as abas abertas voltam depois de recarregar', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');

  await page.reload();

  await expect(aba(page, 'utils.ts')).toBeVisible();
  await expect(aba(page, 'consulta.sql')).toBeVisible();
  // E com o conteúdo, não só o título.
  await expect.poll(() => textoDoEditor(page)).toContain('SELECT');
});

test('a aba que estava em foco continua em foco', async ({ page }) => {
  await abrirArquivo(page, 'consulta.sql');
  await abrirArquivo(page, 'utils.ts');

  await page.reload();
  await expect(page.locator('footer')).toContainText('utils.ts');
});

test('a tela dividida volta dividida, com cada arquivo do seu lado', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Split Editor' }).click();
  await expect(page.locator('[data-grupo-editor="1"]')).toBeVisible();
  await abrirArquivo(page, 'consulta.sql');

  await page.reload();

  await expect(page.locator('[data-grupo-editor="1"]')).toBeVisible();
  await expect(aba(page, 'utils.ts')).toBeVisible();
  await expect(aba(page, 'consulta.sql')).toBeVisible();
});

test('fechar uma aba a mantém fechada depois do F5', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await abrirArquivo(page, 'consulta.sql');
  await page.locator('[data-tab="consulta.sql"] [aria-label="Fechar consulta.sql"]').click();

  await page.reload();
  await expect(aba(page, 'utils.ts')).toBeVisible();
  await expect(aba(page, 'consulta.sql')).toHaveCount(0);
});

test('aba sem título NÃO volta — ela nunca existiu em disco', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText('rascunho');
  await expect(aba(page, 'untitled-1')).toBeVisible();

  // Recarregar com aba suja pede confirmação do navegador; aceita.
  page.once('dialog', (d) => void d.accept());
  await page.reload();

  await expect(aba(page, 'utils.ts')).toBeVisible();
  await expect(aba(page, 'untitled-1')).toHaveCount(0);
});

test('a aba volta com o que está EM DISCO, e não com o que não foi salvo', async ({ page }) => {
  // Restaurar mostrando uma cópia velha de uma edição seria pior que não
  // restaurar: pareceria que o trabalho voltou.
  await abrirArquivo(page, 'utils.ts');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// não salvo');

  page.once('dialog', (d) => void d.accept());
  await page.reload();

  await expect(aba(page, 'utils.ts')).toBeVisible();
  await expect.poll(() => textoDoEditor(page)).not.toContain('não salvo');
});

test('guardar a sessão NÃO entra em laço de renderização', async ({ page }) => {
  // Defeito real, achado por um teste vizinho que passou a falhar sem motivo
  // aparente: a sessão é montada a cada render, e gravar é estado — objeto novo
  // por render faz gravar, gravar re-renderiza, e o ciclo não para. Medido
  // antes do conserto: 330 escritas por segundo, sem um erro na tela. O sintoma
  // era a IDE parar de responder a cliques.
  //
  // O laço só aparecia COM aba aberta: sem nenhuma, a sessão vazia é sempre o
  // mesmo objeto, e o React desistia do render sozinho.
  await abrirArquivo(page, 'utils.ts');

  const escritas = await page.evaluate(() => {
    let n = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      n += 1;
      return original.apply(this, args as never);
    };
    return new Promise<number>((resolve) => setTimeout(() => resolve(n), 1_000));
  });
  expect(escritas).toBeLessThan(5);
});

test('arquivo apagado com a IDE fechada some da sessão, sem erro na tela', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText('vai sumir');
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await entradaRapida(page).fill('efemero.txt');
  await page.keyboard.press('Enter');
  await expect(aba(page, 'efemero.txt')).toBeVisible();

  // Some do disco POR FORA da IDE — é o caso real: apagado noutro terminal, ou
  // por um `git checkout`, enquanto a página estava fechada.
  fs.rmSync(path.join(PASTA_DEMO(process.env.E2E_DATA ?? ''), 'efemero.txt'));

  await page.reload();
  await expect(aba(page, 'efemero.txt')).toHaveCount(0);
  // E sem caixa de erro: uma por arquivo sumido seria pior que a ausência dele.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
