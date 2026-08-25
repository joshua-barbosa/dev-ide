// A aba do servidor e a tabela SFTP (spec 055).
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import { aba, destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';

async function abrirAbaDoServidor(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });

  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();
  await expect(aba(page, CONEXAO_SSH)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a aba do servidor mostra só as sub-abas que a sessão SABE oferecer', async ({ page }) => {
  await abrirAbaDoServidor(page);

  // SSH expõe `files` e `shell` — então SFTP e Terminal existem.
  await expect(page.locator('[data-sub-aba="sftp"]')).toBeVisible();
  await expect(page.locator('[data-sub-aba="terminal"]')).toBeVisible();
  // Monitor e Port Forwarding ainda não são implementados: a sessão não os
  // declara, e por isso a divisória não existe — em vez de existir vazia.
  await expect(page.locator('[data-sub-aba="monitor"]')).toHaveCount(0);
  await expect(page.locator('[data-sub-aba="portas"]')).toHaveCount(0);
});

test('a tabela SFTP lista com as cinco colunas e o caminho à vista', async ({ page }) => {
  await abrirAbaDoServidor(page);
  // A raiz da CONEXÃO, e não `/`: a tabela abre onde a árvore abre.
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/arvore');

  for (const coluna of ['nome', 'tamanho', 'modificado', 'tipo', 'dono']) {
    await expect(page.locator(`[data-coluna="${coluna}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' })).toBeVisible();
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: 'notas.txt' })).toContainText(
    '2.00 KB'
  );
});

test('dois cliques numa pasta ENTRA nela, e o `..` volta', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' }).dblclick();

  await expect(page.locator('[data-caminho-sftp]')).toContainText('/aplicacao');
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: 'README.md' })).toBeVisible();

  await page.locator('[data-linha-sftp=".."]').dblclick();
  await expect(page.locator('[data-caminho-sftp]')).not.toContainText('/aplicacao');
});

test('dois cliques num arquivo ABREM ele no editor', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'notas.txt' }).dblclick();
  await expect(aba(page, 'notas.txt')).toBeVisible();
});

test('ordenar por tamanho põe pasta antes, e inverte só os arquivos', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-coluna="tamanho"]').click();

  // O nome está no atributo, e não no texto: a linha inteira concatena as cinco
  // colunas, e `aplicacao` sai grudado na data.
  const nomes = async (): Promise<string[]> => {
    const caminhos = await page.locator('[data-linha-sftp]').evaluateAll((ns) =>
      ns.map((n) => n.getAttribute('data-linha-sftp') ?? '')
    );
    return caminhos.map((c) => c.split('/').pop() ?? '');
  };
  const crescente = await nomes();
  // As duas primeiras continuam sendo as pastas, em qualquer ordenação.
  expect(crescente.slice(0, 2).sort()).toEqual(['aplicacao', 'logs']);

  await page.locator('[data-coluna="tamanho"]').click();
  const decrescente = await nomes();
  expect(decrescente.slice(0, 2).sort()).toEqual(['aplicacao', 'logs']);
  // E os arquivos, esses sim, viraram de ponta-cabeça.
  expect(decrescente.slice(2)).toEqual([...crescente.slice(2)].reverse());
});

test('a sub-aba escondida NÃO é desmontada: a pasta continua onde estava', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' }).dblclick();
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/aplicacao');

  await page.locator('[data-sub-aba="terminal"]').click();
  await page.locator('[data-sub-aba="sftp"]').click();
  // Voltou para onde estava — e não para a raiz.
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/aplicacao');
});

test('abrir a aba do servidor SEM ter conectado conecta sozinho', async ({ page }) => {
  // Sem isto a aba nascia dizendo "Conectando…" para sempre: ninguém chegava a
  // conectar, porque conectar era efeito de expandir a árvore. Visto no
  // navegador (spec 055).
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();

  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

  await expect(page.locator('[data-sub-aba="sftp"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/arvore');
});
