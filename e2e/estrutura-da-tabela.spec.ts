// A sub-aba Estrutura (spec 045).
//
// O que cada driver responde é testado contra um motor de verdade em
// `sqlite.driver.test.ts`. Aqui se prova a tela: as sub-abas, a preguiça da
// busca, e a distinção entre "nenhum" e "este banco não sabe responder".
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import {
  aba, destrancarCofre, entradaRapida, expandir, linhaArvore, painelLateral, textoDoEditor,
  esperarIdePronta,
} from './fixtures';

const estrutura = (page: Page) => page.getByRole('tab', { name: 'estrutura' });

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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a aba abre em Dados, e a Estrutura só busca quando é aberta', async ({ page }) => {
  // Ninguém paga por uma aba que não abriu.
  await abrirTabela(page);
  await expect(page.getByRole('tab', { name: 'dados' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-cabecalho-estrutura]')).toHaveCount(0);

  await estrutura(page).click();
  await expect(page.locator('[data-cabecalho-estrutura]')).toBeVisible();
});

test('as colunas trazem tipo, chave e obrigatoriedade', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();

  const id = page.locator('[data-coluna-estrutura="id"]');
  await expect(id).toContainText('INTEGER');
  const nome = page.locator('[data-coluna-estrutura="nome"]');
  await expect(nome).toContainText('TEXT');
});

test('o DDL aparece inteiro', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();
  await page.getByRole('tab', { name: 'DDL' }).click();
  await expect(page.locator('[data-ddl]')).toContainText('CREATE TABLE');
});

test('"não sei responder" é diferente de "nenhum"', async ({ page }) => {
  // Confundir os dois diria que a tabela não tem gatilho, quando o que
  // acontece é que a IDE não sabe perguntar ao SQLite.
  await abrirTabela(page);
  await estrutura(page).click();

  await page.getByRole('tab', { name: 'Gatilhos' }).click();
  await expect(page.locator('[data-aviso-estrutura]')).toContainText('SQLite');

  await page.getByRole('tab', { name: 'Chaves estrangeiras' }).click();
  await expect(page.locator('[data-aviso-estrutura]')).toHaveText('Nenhum.');
});

test('trocar de sub-aba NÃO perde o que estava nos dados', async ({ page }) => {
  // Mesma regra do editor e do terminal: esconder, nunca desmontar.
  await abrirTabela(page);
  await page.getByLabel('Filtrar nome').fill('josh');
  await expect(page.locator('[data-total-da-tabela]')).toContainText('de 1');

  await estrutura(page).click();
  await page.getByRole('tab', { name: 'dados' }).click();
  await expect(page.getByLabel('Filtrar nome')).toHaveValue('josh');
  await expect(page.locator('[data-total-da-tabela]')).toContainText('de 1');
});

test('a view mostra menos sub-abas que a tabela', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();
  await expect(page.getByRole('tab', { name: 'Índices' })).toBeVisible();

  await painelLateral(page, 'Database').click();
  await linhaArvore(page, 'Views').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, 'alunos_view').hover();
  await page.getByRole('button', { name: 'Abrir tabela alunos_view', exact: true }).click();
  await estrutura(page).click();

  // Numa view não há índice, chave estrangeira nem checagem que valha mostrar.
  await expect(page.getByRole('tab', { name: 'Índices' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'DDL' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Alterar a estrutura (spec 046)
// ---------------------------------------------------------------------------

test('acrescentar coluna GERA o comando, e não o executa', async ({ page }) => {
  // É a decisão central da spec 046: um ALTER numa tabela grande é operação de
  // janela de manutenção, e você escolhe quando.
  await abrirTabela(page);
  await estrutura(page).click();

  await page.getByRole('button', { name: '+ coluna' }).click();
  await entradaRapida(page).fill('criado_em');
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill('TEXT');
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: 'Não' }).click();
  await page.keyboard.press('Enter');

  await expect.poll(() => textoDoEditor(page)).toContain('ADD COLUMN');
  expect(await textoDoEditor(page)).toContain('"criado_em"');

  // A coluna NÃO existe ainda: o comando só foi aberto numa aba nova, que
  // passou a ser a ativa — por isso o caminho de volta pela aba da tabela.
  await aba(page, TABELA).click();
  await page.getByRole('tab', { name: 'estrutura' }).click();
  await page.getByLabel('Recarregar a estrutura').click();
  await expect(page.locator('[data-coluna-estrutura="criado_em"]')).toHaveCount(0);
});

test('apagar coluna vem com o aviso de que reescreve a tabela', async ({ page }) => {
  await abrirTabela(page);
  await estrutura(page).click();

  await page.locator('[data-coluna-estrutura="nome"]').getByRole('button', { name: 'apagar' }).click();
  await expect.poll(() => textoDoEditor(page)).toContain('DROP COLUMN');
  const texto = await textoDoEditor(page);
  expect(texto).toContain('ainda NÃO rodou');
  expect(texto).toContain('REESCREVE');
});

test('o SQLite NÃO oferece alterar coluna, porque não faz', async ({ page }) => {
  // Botão que sempre dá erro é pior que nenhum botão.
  await abrirTabela(page);
  await estrutura(page).click();

  const linha = page.locator('[data-coluna-estrutura="nome"]');
  await expect(linha.getByRole('button', { name: 'renomear' })).toBeVisible();
  await expect(linha.getByRole('button', { name: 'alterar' })).toHaveCount(0);
  // E comentário de tabela também não.
  await expect(page.getByRole('button', { name: 'Comentário' })).toHaveCount(0);
});

test('a view NÃO oferece alteração nenhuma', async ({ page }) => {
  await abrirTabela(page);
  await painelLateral(page, 'Database').click();
  await linhaArvore(page, 'Views').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, 'alunos_view').hover();
  await page.getByRole('button', { name: 'Abrir tabela alunos_view', exact: true }).click();
  await estrutura(page).click();

  await expect(page.getByRole('button', { name: 'Renomear tabela' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ coluna' })).toHaveCount(0);
});
