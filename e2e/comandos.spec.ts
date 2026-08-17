// Barra de menu, paleta e arquivos sem título.
//
// O que interessa aqui é o fluxo que motivou a spec: criar sem responder caixa
// nenhuma, e só nomear ao salvar.
import { expect, test } from '@playwright/test';
import { entradaRapida, menu, rodape } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a barra traz os oito menus do VS Code', async ({ page }) => {
  for (const nome of ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']) {
    await expect(page.getByRole('button', { name: nome, exact: true })).toBeVisible();
  }
});

test('o menu mostra o não implementado desabilitado, em vez de esconder', async ({ page }) => {
  await menu(page, 'File');

  // Implementado e disponível.
  await expect(page.getByRole('menuitem', { name: /New Text File/ })).toBeEnabled();
  // Declarado e ainda sem implementação — o usuário pediu ver o mapa inteiro.
  const pendente = page.getByRole('menuitem', { name: /Open Recent/ });
  await expect(pendente).toBeVisible();
  await expect(pendente).toBeDisabled();
  await expect(pendente).toContainText('em breve');
});

test('comando indisponível aparece cinza sem aba aberta', async ({ page }) => {
  await menu(page, 'File');
  // Sem editor não há o que salvar; o item continua visível para ensinar que existe.
  await expect(page.getByRole('menuitem', { name: /^Save/ }).first()).toBeDisabled();
});

test('novo arquivo abre untitled-1 sem perguntar nada', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();

  // Nenhuma caixa de diálogo: o nome só é pedido ao salvar.
  await expect(page.locator('[data-tab="untitled-1"]')).toBeVisible();
  await expect(page.locator('[data-tab="untitled-1"]')).toHaveAttribute('data-tab-dirty', 'true');
});

test('o segundo arquivo novo é untitled-2', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();

  await expect(page.locator('[data-tab="untitled-2"]')).toBeVisible();
});

test('salvar pede o nome pela entrada rápida, e cancelar preserva a aba', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await page.locator('textarea').first().fill('console.log("do untitled");');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();

  await expect(entradaRapida(page)).toBeVisible();
  await page.keyboard.press('Escape');

  // Cancelar não pode custar o que foi digitado.
  await expect(page.locator('[data-tab="untitled-1"]')).toBeVisible();
  await expect(page.locator('textarea').first()).toHaveValue('console.log("do untitled");');
});

test('a paleta abre com Ctrl+Shift+P e executa o comando escolhido', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  await expect(entradaRapida(page)).toBeVisible();

  await entradaRapida(page).fill('new text');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-tab="untitled-1"]')).toBeVisible();
});

test('a paleta esconde o comando indisponível', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  await entradaRapida(page).fill('save');

  // Sem editor, "Save" não executa — e resultado que não executa é ruído.
  await expect(page.getByRole('option', { name: /^Save$/ })).toHaveCount(0);
});

test('Esc fecha a paleta sem executar nada', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.press('Escape');

  await expect(entradaRapida(page)).toHaveCount(0);
  await expect(page.locator('[data-tab="untitled-1"]')).toHaveCount(0);
});

test('a linguagem fica no rodapé e troca pela entrada rápida', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();

  const seletor = page.getByRole('button', { name: 'Selecionar linguagem' });
  await expect(seletor).toBeVisible();
  await seletor.click();

  await entradaRapida(page).fill('Python');
  await page.keyboard.press('Enter');
  await expect(rodape(page)).toContainText('Python');
});

test('as abas da lateral ficam só com ícone, mantendo o nome acessível', async ({ page }) => {
  for (const nome of ['Arquivos', 'Símbolos', 'Database', 'Service']) {
    const tab = page.getByRole('tab', { name: nome });
    await expect(tab).toBeVisible();
    // O texto sai da tela, mas o nome continua existindo para leitor e teste.
    await expect(tab).not.toContainText(nome);
  }
});

test('a aba de painel ativa fica destacada', async ({ page }) => {
  // Regressão real: envolver o Tab num Tooltip fez o MUI parar de injetar a
  // seleção, e o indicador ficou com largura zero — nenhuma aba parecia ativa.
  await expect(page.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Database' }).click();
  await expect(page.getByRole('tab', { name: 'Database' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute('aria-selected', 'false');

  // O indicador precisa ter largura de verdade, não só existir no DOM.
  const largura = await page.locator('.MuiTabs-indicator').evaluate(
    (el) => Number.parseFloat(getComputedStyle(el).width)
  );
  expect(largura).toBeGreaterThan(0);
});
