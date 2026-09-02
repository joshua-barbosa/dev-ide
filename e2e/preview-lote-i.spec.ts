// O switch de preview, Mermaid, LaTeX e os visualizadores (T025, T026, T027).
//
// Os três vinham dos `Non-Goals` da spec 024. Em dois eu não escrevi desculpa
// nenhuma — só listei. No terceiro escrevi "é outra feature", e ele corrigiu o
// desenho: não é ao lado, é um switch na PRÓPRIA aba.
import { expect, test, type Page } from '@playwright/test';
import {
  abrirArquivo, entradaRapida, esperarEditorPronto, esperarIdePronta, menu, painelLateral,
} from './fixtures';

/**
 * Nome único por EXECUÇÃO, e não só por teste.
 *
 * A pasta de teste PERSISTE entre execuções: um contador que reinicia do 1
 * tenta salvar por cima do arquivo da rodada anterior, e o fluxo de "salvar
 * com nome" deixa de ser o que o teste presume. Rodando o arquivo sozinho
 * passava; na suíte inteira, depois de já ter rodado antes, não.
 */
const RODADA = Math.random().toString(36).slice(2, 8);
let proximo = 0;
const novoNome = (ext: string): string => `lote-i-${RODADA}-${(proximo += 1)}.${ext}`;

async function criarArquivo(page: Page, nome: string, conteudo: string): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText(conteudo);
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await entradaRapida(page).fill(nome);
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-tab="${nome}"]`)).toBeVisible();
}

const preview = (page: Page) => page.locator('[data-markdown-preview]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

// ---- T025: o switch de dois rótulos ----

test('o switch mostra `Markdown` e `Preview`, e diz em qual está', async ({ page }) => {
  await criarArquivo(page, novoNome('md'), '# Um título\n\nUm parágrafo.\n');

  const barra = page.locator('[data-barra-do-arquivo]');
  const markdown = barra.getByRole('radio', { name: 'Markdown' });
  const renderizado = barra.getByRole('radio', { name: 'Preview' });

  // Era um botão só que alternava e mudava de ícone — ninguém sabia em qual dos
  // dois estados estava sem interpretar o ícone.
  await expect(markdown).toHaveAttribute('aria-checked', 'true');
  await expect(renderizado).toHaveAttribute('aria-checked', 'false');

  await renderizado.click();
  await expect(preview(page)).toBeVisible();
  await expect(renderizado).toHaveAttribute('aria-checked', 'true');
  await expect(markdown).toHaveAttribute('aria-checked', 'false');
});

test('clicar no modo em que JÁ ESTÁ não alterna', async ({ page }) => {
  await criarArquivo(page, novoNome('md'), '# Título\n');
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  await expect(preview(page)).toBeVisible();

  // Quem clica em `Preview` estando no preview espera continuar nele. Alternar
  // ali transformaria o switch num botão de novo.
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  await expect(preview(page)).toBeVisible();
});

// ---- T026: Mermaid e LaTeX ----

test('um bloco ```mermaid vira DESENHO, e não código', async ({ page }) => {
  await criarArquivo(
    page,
    novoNome('md'),
    '# Fluxo\n\n```mermaid\ngraph TD\n  A[Começo] --> B[Fim]\n```\n'
  );
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  await expect(preview(page)).toBeVisible();

  // O SVG tem de ser o DO DIAGRAMA. `locator('svg')` sozinho casa com qualquer
  // ícone do preview e passa enquanto o mermaid ainda desenha — e aí a linha
  // seguinte pega o `<pre>` que ainda não foi substituído. Foi assim que este
  // teste falhou uma vez na suíte inteira e passou sozinho.
  const diagrama = preview(page).locator('.mermaid-por-desenhar');
  await expect(diagrama.locator('svg')).toBeVisible({ timeout: 20_000 });
  // E o aviso "desenhando…" já saiu: enquanto ele está lá, o desenho não acabou.
  await expect(diagrama).not.toHaveAttribute('data-mermaid-desenhando', 'true');
  await expect(preview(page).locator('pre code')).toHaveCount(0);
});

test('diagrama com erro mostra a MENSAGEM, e não some', async ({ page }) => {
  await criarArquivo(page, novoNome('md'), '```mermaid\nisto não é um diagrama {{{\n```\n');
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  // Um bloco em branco pareceria a IDE quebrada.
  await expect(preview(page).locator('[data-mermaid-erro]')).toBeVisible({ timeout: 20_000 });
});

test('`$x^2$` vira fórmula, e `R$ 10` continua sendo dinheiro', async ({ page }) => {
  await criarArquivo(page, novoNome('md'), 'A área é $x^2$ e custa R$ 10 por metro.\n');
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  await expect(preview(page)).toBeVisible();

  // O KaTeX marca o que renderizou com a classe `katex`.
  await expect(preview(page).locator('.katex').first()).toBeVisible({ timeout: 20_000 });
  // Uma só: o `R$ 10` não pode ter virado matemática.
  await expect(preview(page).locator('.katex')).toHaveCount(1);
  await expect(preview(page)).toContainText('R$ 10');
});

test('`$` dentro de bloco de código NÃO vira fórmula', async ({ page }) => {
  await criarArquivo(page, novoNome('md'), 'Texto.\n\n```sh\necho $HOME e $USER\n```\n');
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  await expect(preview(page).locator('pre code')).toBeVisible();
  // Ali `$HOME` é o texto `$HOME` — é justamente onde se escreve isso.
  await expect(preview(page).locator('.katex')).toHaveCount(0);
});

// ---- T027: imagem, CSV e PDF ----

test('um CSV abre na GRADE, com as colunas do cabeçalho', async ({ page }) => {
  const nome = novoNome('csv');
  await criarArquivo(page, nome, 'nome,idade\njoshua,40\nmaria,35\n');
  // Fecha e reabre pela árvore: salvar deixa a aba de TEXTO aberta, e o que se
  // quer provar é o caminho de ABRIR.
  await page.locator(`[data-tab="${nome}"] [aria-label^="Fechar"]`).click();
  // Pela ÁRVORE, que é o caminho do usuário — e o painel se chama `Arquivos`,
  // não `Explorer`: é o nome que `esperarIdePronta` já espera.
  await painelLateral(page, 'Arquivos').click();
  await abrirArquivo(page, nome);

  await expect(page.locator('[data-visualizador="csv"]')).toBeVisible();
  await expect(page.getByText('joshua')).toBeVisible();
  await expect(page.locator('[data-coluna="idade"]')).toBeVisible();
});

test('o separador vem do CONTEÚDO: um CSV com `;` abre certo', async ({ page }) => {
  const nome = novoNome('csv');
  await criarArquivo(page, nome, 'nome;cidade\njoshua;diadema\n');
  await page.locator(`[data-tab="${nome}"] [aria-label^="Fechar"]`).click();
  await painelLateral(page, 'Arquivos').click();
  await abrirArquivo(page, nome);

  // Com `,` fixo, isto viraria UMA coluna chamada `nome;cidade`.
  await expect(page.locator('[data-coluna="cidade"]')).toBeVisible();
});

test('o switch fica em LINHA PRÓPRIA, à direita — e não no meio das abas', async ({ page }) => {
  // Ele mandou o print: com três arquivos abertos, o switch aparecia grudado
  // no fim da última aba, no meio da tela. E havia um defeito junto: os dois
  // controles usavam `ml: auto` CONDICIONAL ao outro não existir, então com
  // `Markdown|Preview` e `▷` na tela nenhum era empurrado para a direita.
  await criarArquivo(page, novoNome('md'), '# Um\n');
  await criarArquivo(page, novoNome('md'), '# Dois\n');
  await criarArquivo(page, novoNome('md'), '# Três\n');

  const medidas = await page.evaluate(() => {
    const barra = document.querySelector('[data-barra-do-arquivo]') as HTMLElement;
    const grupo = barra.querySelector('[role="radiogroup"]') as HTMLElement;
    const abas = document.querySelector('[data-tab]')?.parentElement as HTMLElement;
    return {
      // Linhas diferentes: a das abas fica ACIMA.
      linhaDasAbas: Math.round(abas.getBoundingClientRect().bottom),
      topoDaBarra: Math.round(barra.getBoundingClientRect().top),
      // Encostado à direita da janela.
      folgaDaDireita: Math.round(window.innerWidth - grupo.getBoundingClientRect().right),
      // E o switch NÃO está dentro da barra de abas.
      dentroDasAbas: abas.contains(grupo),
    };
  });

  expect(medidas.dentroDasAbas).toBe(false);
  expect(medidas.topoDaBarra).toBeGreaterThanOrEqual(medidas.linhaDasAbas);
  expect(medidas.folgaDaDireita).toBeLessThan(30);
});
