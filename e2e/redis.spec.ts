// A árvore, a chave e o estado de um Redis, pela TELA (spec 089).
//
// Ele em 03/09/2026: *"não consigo rodar nada, não abre as informações dentro
// da chave... nada"*. Estes testes existem para essa frase não voltar.
//
// Rodam contra o `redis-server` descartável da suíte. Sem Redis na máquina, a
// conexão não é criada e eles pulam — a mesma regra do `sshd`.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_REDIS, SENHA_MESTRA } from './global-setup';
import type { Locator } from '@playwright/test';
import {
  aba, destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral,
} from './fixtures';

/**
 * Abre um nó SÓ se ele ainda não estiver aberto.
 *
 * A árvore guarda o que está expandido e o traz de volta ao recarregar a
 * página — então um clique cego FECHA o que o teste anterior deixou aberto, e a
 * falha aparece no teste seguinte, longe da causa.
 */
async function garantirAberto(page: Page, no: Locator, filho: string): Promise<void> {
  await expect(no).toBeVisible({ timeout: 20_000 });
  if (await linhaArvore(page, filho).first().isVisible().catch(() => false)) return;
  await no.click();
  await expect(linhaArvore(page, filho).first()).toBeVisible({ timeout: 20_000 });
}

async function abrirCache(page: Page): Promise<boolean> {
  await painelLateral(page, 'Database').click();
  const destrancar = page.getByRole('button', { name: 'Destrancar o cofre' });
  if (await destrancar.isVisible().catch(() => false)) {
    await destrancar.click();
    await destrancarCofre(page, SENHA_MESTRA);
  }
  await expandir(page, 'ACME', 'Bancos');
  const conexao = linhaArvore(page, CONEXAO_REDIS);
  if ((await conexao.count()) === 0) return false;
  // Dentro da conexão nasce o nó do SERVIDOR, com o MESMO rótulo dela e a
  // versão como detalhe — a mesma forma do PostgreSQL. São duas linhas de nome
  // igual, e é por isso que a navegação aqui é contada em vez de adivinhada.
  if ((await conexao.count()) === 1) {
    await conexao.first().click();
    await expect(linhaArvore(page, CONEXAO_REDIS)).toHaveCount(2, { timeout: 20_000 });
  }
  await garantirAberto(page, linhaArvore(page, CONEXAO_REDIS).last(), 'Chaves');
  await garantirAberto(page, linhaArvore(page, 'Chaves'), 'app');
  await garantirAberto(page, linhaArvore(page, 'app'), 'saudacao');
  return true;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a árvore desce até a CHAVE, e não repete a categoria', async ({ page }) => {
  test.skip(!(await abrirCache(page)), 'sem redis-server nesta máquina');

  // Expandir `Chaves` devolvia `Chaves` de novo até a spec 088 — a árvore
  // supunha um nó de servidor que nunca emitia.
  // Expandir `Chaves` devolvia `Chaves` de novo até a spec 088.
  await expect(linhaArvore(page, 'Chaves')).toHaveCount(1);
  await expect(linhaArvore(page, 'saudacao')).toBeVisible();
});

test('clicar numa chave abre a CHAVE — e não um SELECT * FROM', async ({ page }) => {
  test.skip(!(await abrirCache(page)), 'sem redis-server nesta máquina');
  await linhaArvore(page, 'saudacao').click();

  await expect(aba(page, 'app:saudacao')).toBeVisible();
  await expect(page.locator('[data-aba-de-chave="app:saudacao"]')).toBeVisible();
  // A prova de que o caminho velho morreu: nenhum editor com SQL nasceu.
  await expect(page.locator('.monaco-editor')).toHaveCount(0);

  const valor = page.locator('[data-valor-da-chave="app:saudacao"]');
  await expect(valor).toHaveValue('bom dia');
});

test('JSON guardado como texto abre FORMATADO', async ({ page }) => {
  test.skip(!(await abrirCache(page)), 'sem redis-server nesta máquina');
  await linhaArvore(page, 'config').click();

  const valor = page.locator('[data-valor-da-chave="app:config"]');
  await expect(valor).toBeVisible();
  // Formatado quer dizer com quebra de linha — o guardado é uma linha só.
  await expect.poll(() => valor.inputValue()).toMatch(/\n\s+"tema": "escuro"/);
});

test('lista e mapa abrem em GRADE, com as colunas de cada tipo', async ({ page }) => {
  test.skip(!(await abrirCache(page)), 'sem redis-server nesta máquina');

  await linhaArvore(page, 'fila').click();
  const daFila = page.locator('[data-aba-de-chave="app:fila"]');
  await expect(daFila.getByText('primeiro')).toBeVisible();
  await expect(daFila.locator('th', { hasText: '#' })).toBeVisible();

  await linhaArvore(page, 'usuario').click();
  const doMapa = page.locator('[data-aba-de-chave="app:usuario"]');
  await expect(doMapa.locator('th', { hasText: 'Campo' })).toBeVisible();
  await expect(doMapa.getByText('ana')).toBeVisible();
});

test('gravar o valor GRAVA, e o prazo vira um prazo de verdade', async ({ page }) => {
  test.skip(!(await abrirCache(page)), 'sem redis-server nesta máquina');
  await linhaArvore(page, 'saudacao').click();

  const valor = page.locator('[data-valor-da-chave="app:saudacao"]');
  await valor.fill('boa noite');
  await page.getByRole('button', { name: 'Save' }).click();

  // Recarrega do servidor: o que volta é o que ficou gravado.
  await page.getByRole('button', { name: 'Recarregar a chave' }).click();
  await expect.poll(() => valor.inputValue()).toBe('boa noite');

  await page.getByLabel('TTL').fill('300');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-aba-de-chave="app:saudacao"]')).toContainText('min');
});

test('o painel Status conta a versão e as chaves por banco', async ({ page }) => {
  test.skip(!(await abrirCache(page)), 'sem redis-server nesta máquina');
  await linhaArvore(page, 'saudacao').click();
  await page.getByRole('button', { name: 'Status' }).click();

  const painel = page.locator('[data-estado-do-servidor]');
  await expect(painel).toBeVisible();
  await expect(painel.getByText('Connected Clients')).toBeVisible();
  await expect(painel.getByText('db0')).toBeVisible();
});
