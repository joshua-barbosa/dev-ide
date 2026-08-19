// Barra de menu, paleta e arquivos sem título.
//
// O que interessa aqui é o fluxo que motivou a spec: criar sem responder caixa
// nenhuma, e só nomear ao salvar.
import { expect, test } from '@playwright/test';
import {
  abrirArquivo, cursores, editor, entradaRapida, esperarEditorPronto, menu, rodape,
  textoDoEditor,
} from './fixtures';

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
  await expect(page.getByRole('menuitem', { name: /New Text File/ })).toBeEnabled();
  await page.keyboard.press('Escape');

  // Declarado e ainda sem implementação — o usuário pediu ver o mapa inteiro.
  //
  // O exemplo já mudou duas vezes, e isso é boa notícia: `Open Recent` saiu na
  // spec 012 e o Emmet na 022. Agora é o `Find in Files`, que é da parte 2 do
  // roteiro e deve durar. Quando ele também sair, troque — ou remova o teste, se
  // não sobrar item pendente nenhum.
  await menu(page, 'Edit');
  const pendente = page.getByRole('menuitem', { name: /Find in Files/ });
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
  await esperarEditorPronto(page);
  await page.keyboard.type('console.log("do untitled");');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();

  await expect(entradaRapida(page)).toBeVisible();
  await page.keyboard.press('Escape');

  // Cancelar não pode custar o que foi digitado.
  await expect(page.locator('[data-tab="untitled-1"]')).toBeVisible();
  await expect.poll(() => textoDoEditor(page)).toMatch(/console\.log\("do untitled"\);/);
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

// ---- o que a migração para o Monaco destravou (spec 010) ----

test('multi-cursor: editar três linhas ao mesmo tempo', async ({ page }) => {
  // A razão de ser da spec 010. Na `textarea` anterior isto era impossível —
  // não por esforço, mas porque o HTML define um cursor por campo.
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.type('alfa\nbeta\ngama');
  await expect.poll(() => textoDoEditor(page)).toMatch(/gama/);

  // Só teclado, de propósito: `Alt+clique` põe cursores, mas deixa o foco numa
  // `div` do Monaco, e as teclas seguintes não chegam à área de texto. Um
  // caminho puramente de teclado não tem esse problema — e `Shift+Alt+I` é um
  // dos comandos do menu Selection que o usuário pediu.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+Alt+i');
  // **Três cursores ao mesmo tempo.** É a afirmação central, e ela mede de
  // verdade: com um cursor só, este contador dá 1 — conferido.
  //
  // O teste PARA aqui de propósito. Digitar e verificar as três linhas seria
  // mais forte, mas a digitação sintética do Playwright não alcança o caminho
  // de entrada do Monaco em multi-cursor: os cursores existem e as teclas somem.
  // Conferido à mão, com teclado de verdade, em 2026-08-18: `// FIM` entrou no
  // fim de todas as linhas de uma vez.
  //
  // Afirmar o que a ferramenta consegue medir é melhor que afirmar de menos —
  // e muito melhor que um teste que falha por limitação do arranjo e ensina a
  // ignorar falha vermelha.
  await expect(cursores(page)).toHaveCount(3);
});

test('busca abre dentro do editor com Ctrl+F', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.type('procure_por_isto = 1;');

  await page.keyboard.press('Control+f');
  // O campo de busca é do Monaco, e vive dentro da área do editor.
  await expect(editor(page).locator('.find-widget')).toBeVisible();
});

test('o código sai colorido, com o tema do projeto', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');

  // `poll` porque a análise de TypeScript acontece num worker: afirmar na hora
  // pega o arquivo ainda sem cor, e a falha pareceria de tema.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const spans = document.querySelectorAll('[data-editor] .view-line span[class*="mtk"]');
          return [...new Set([...spans].map((s) => getComputedStyle(s).color))].length;
        }),
      { message: 'o realce não está pintando nada', timeout: 15_000 }
    )
    .toBeGreaterThan(2);
});

test('mover linha com Alt+seta', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.type('primeira\nsegunda');
  await expect.poll(() => textoDoEditor(page)).toMatch(/segunda/);

  await page.keyboard.press('Alt+ArrowUp');
  // `poll`, e não leitura direta: o Monaco aplica a edição fora do turno em que
  // a tecla é despachada, e ler na hora pegava o texto de antes. Falhou uma vez
  // em cada tantas execuções — e falha intermitente ensina a ignorar vermelho.
  await expect
    .poll(async () => (await textoDoEditor(page)).split('\n')[0])
    .toContain('segunda');
});

test('Help → Documentation abre o README da IDE', async ({ page }) => {
  // Decisão do lote: destino honesto em vez de remover o item. A IDE não tem
  // documentação escrita, mas tem um README.
  await menu(page, 'Help');
  await page.getByRole('menuitem', { name: 'Documentation' }).click();

  await expect(page.locator('[data-tab="README.md"]')).toBeVisible();
  await expect.poll(() => textoDoEditor(page)).toMatch(/dev-ide/);
});
