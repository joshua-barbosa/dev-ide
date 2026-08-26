// Filtro por coluna com operadores (T057 · spec 041).
//
// Na spec 041 eu escrevi que "`contém` cobre o uso diário". Cobria o meu palpite
// sobre o dia dele. Ele resgatou da lista dos 114.
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

const filtrar = (page: Page, coluna: string, valor: string) =>
  page.getByLabel(`Filtrar ${coluna}`).fill(valor);

const sql = (page: Page) => page.locator('[data-sql-da-tabela]');
const total = (page: Page) => page.locator('[data-total-da-tabela]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('sem sinal continua sendo `contém` — o dedo de quem já usa não quebra', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'nome', 'josh');
  await expect(sql(page)).toContainText('LIKE');
  await expect(total(page)).toContainText('de 1');
  await expect(page.getByText('joshua')).toBeVisible();
});

test('`>` vira comparação de verdade, e não texto procurado', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'id', '>1');
  // O SQL fica à vista no topo: é o que torna o filtro auditável.
  await expect(sql(page)).toContainText('> ?');
  await expect(sql(page)).not.toContainText('LIKE');
  await expect(page.getByText('maria')).toBeVisible();
  await expect(page.getByText('joshua')).toHaveCount(0);
});

test('a tela diz o que ENTENDEU do que foi digitado', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'id', '>=2');
  // Sai da mesma função pura que monta o `WHERE` no servidor.
  await expect(page.locator('[data-leitura-do-filtro]')).toHaveText('maior ou igual a 2');
});

test('a leitura NÃO aparece no padrão: seria ruído embaixo de toda caixa', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'nome', 'ana');
  await expect(page.locator('[data-leitura-do-filtro]')).toHaveCount(0);
});

test('intervalo vira BETWEEN', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'id', '1..1');
  await expect(sql(page)).toContainText('BETWEEN');
  await expect(total(page)).toContainText('de 1');
  await expect(page.getByText('joshua')).toBeVisible();
});

test('`null` vira IS NULL, e o total conta certo', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'nota', 'null');
  await expect(sql(page)).toContainText('IS NULL');
  // O `alunos` de teste não tem nota nula: zero é a resposta CERTA, e prova que
  // a condição foi para o banco em vez de virar `LIKE '%null%'`.
  await expect(total(page)).toContainText('de 0');
});

test('`!null` traz o resto', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'nota', '!null');
  await expect(sql(page)).toContainText('IS NOT NULL');
  await expect(total(page)).toContainText('de 2');
});

test('operador pela metade não devolve a tabela inteira calado', async ({ page }) => {
  await abrirTabela(page);
  await filtrar(page, 'id', '>');
  // Sem `WHERE`: `>` sozinho é meio caminho, e filtrar por string vazia
  // devolveria tudo sem o usuário entender por quê.
  await expect(sql(page)).not.toContainText('WHERE');
  await expect(total(page)).toContainText('de 2');
});
