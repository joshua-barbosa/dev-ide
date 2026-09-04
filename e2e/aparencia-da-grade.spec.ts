// O `👁` da barra: a aparência da grade (spec 062, fase E · D56).
//
// Eu tinha mandado isto para o backlog por conta própria, escrevendo que era
// "preferência de aparência, não leitura de dado". Não era minha decisão a
// tomar — ele mandou fazer, como fase própria.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, TABELA).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

const painel = (page: Page) => page.locator('[data-painel-de-aparencia]');

async function abrirOlho(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Aparência da grade' }).click();
  await expect(painel(page)).toBeVisible();
}

/** A altura que o navegador de fato pintou na primeira linha de dados. */
const alturaDaLinha = (page: Page) =>
  page.evaluate(() =>
    Math.round(
      document.querySelector('[data-grade] tbody tr')!.getBoundingClientRect().height
    )
  );

const quantasColunas = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('[data-grade] tbody tr:first-child td').length);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o padrão da grade é régua horizontal, não moldura', async ({ page }) => {
  await abrirTabela(page);
  // A borda era `Todas` — um retângulo em volta de CADA célula. Ele pediu
  // "densidade e respiro" e "cores e contraste" por escrito (spec 097).
  // A PRIMEIRA célula de dado é o número da linha; a seta que abre a linha vem
  // antes dela, e é controle, não dado.
  await expect(
    page.locator('[data-grade] tbody tr').first().locator('td').nth(1)
  ).toContainText('1');
  await abrirOlho(page);
  await expect(painel(page).getByRole('switch', { name: 'Número da linha' })).toHaveAttribute('aria-checked', 'true');
  await expect(painel(page).getByRole('radio', { name: 'Alinhamento: Auto' })).toHaveAttribute('aria-checked', 'true');
  await expect(painel(page).getByRole('radio', { name: 'Borda: Horizontal' })).toHaveAttribute('aria-checked', 'true');
});

test('aumentar a altura da linha muda a grade de verdade', async ({ page }) => {
  await abrirTabela(page);
  const antes = await alturaDaLinha(page);
  await abrirOlho(page);
  for (let i = 0; i < 5; i += 1) {
    await painel(page).getByRole('button', { name: 'Aumentar a altura da linha' }).click();
  }
  await expect.poll(() => alturaDaLinha(page)).toBeGreaterThan(antes + 8);
});

test('a altura tem parede: o botão desabilita no mínimo', async ({ page }) => {
  await abrirTabela(page);
  await abrirOlho(page);
  const diminuir = painel(page).getByRole('button', { name: 'Diminuir a altura da linha' });
  for (let i = 0; i < 20; i += 1) {
    if (await diminuir.isDisabled()) break;
    await diminuir.click();
  }
  await expect(diminuir).toBeDisabled();
  // Uma grade que não se lê e não se conserta pela interface seria pior que
  // nenhuma opção de altura.
  await expect(painel(page).locator('[data-altura-da-linha]')).toHaveText('16');
});

test('desligar o número da linha tira a coluna, e não só a esconde', async ({ page }) => {
  await abrirTabela(page);
  const antes = await quantasColunas(page);
  await abrirOlho(page);
  await painel(page).getByRole('switch', { name: 'Número da linha' }).click();
  await expect.poll(() => quantasColunas(page)).toBe(antes - 1);
});

test('o alinhamento à direita vale para toda coluna, e o auto só para número', async ({ page }) => {
  await abrirTabela(page);
  // Pela COLUNA, e não pela posição: as colunas de controle da esquerda mudam,
  // e contar `td` fazia este teste falhar sem dizer o que tinha mudado.
  const alinhamentoDe = (coluna: string) =>
    page.evaluate(
      (c) =>
        getComputedStyle(
          document.querySelector(
            `[data-grade] tbody tr:first-child [data-celula-da-coluna="${c}"]`
          ) as HTMLElement
        ).textAlign,
      coluna
    );

  // `auto`: `id` é INTEGER e vai à direita; `nome` é TEXT e fica à esquerda.
  // É o que casa a vírgula decimal na vertical, e o que toda planilha faz.
  expect(await alinhamentoDe('id')).toBe('right');
  expect(await alinhamentoDe('nome')).toBe('left');

  await abrirOlho(page);
  await painel(page).getByRole('radio', { name: 'Alinhamento: Centro' }).click();
  await expect.poll(() => alinhamentoDe('nome')).toBe('center');
  await expect.poll(() => alinhamentoDe('id')).toBe('center');
});

test('tirar a borda tira a borda; voltar ao padrão devolve tudo', async ({ page }) => {
  await abrirTabela(page);
  // A de BAIXO, e não a da direita: o padrão passou a ser régua horizontal, e a
  // vertical só existe quando ele escolhe.
  const bordaDeBaixo = () =>
    page.evaluate(() =>
      getComputedStyle(
        document.querySelector('[data-grade] tbody tr:first-child td') as HTMLElement
      ).borderBottomWidth
    );
  expect(await bordaDeBaixo()).not.toBe('0px');

  await abrirOlho(page);
  await painel(page).getByRole('radio', { name: 'Borda: Nenhuma' }).click();
  await expect.poll(bordaDeBaixo).toBe('0px');

  await painel(page).getByRole('button', { name: 'Voltar ao padrão' }).click();
  await expect.poll(bordaDeBaixo).not.toBe('0px');
});
