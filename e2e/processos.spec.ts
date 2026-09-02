// A lista de processos (spec 047).
//
// O SQLite não tem processos — é um arquivo, não um servidor. Isso limita o que
// dá para provar aqui, e o que dá é justamente o mais importante: que a IDE diz
// "este banco não tem o conceito" em vez de mostrar uma lista vazia.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirProcessos(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Ver processos/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a conexão oferece ver processos, e a aba abre', async ({ page }) => {
  await abrirProcessos(page);
  await expect(aba(page, `Processos · ${CONEXAO}`)).toBeVisible();
});

test('"não tem o conceito" é dito, e não vira lista vazia', async ({ page }) => {
  // Confundir os dois diria que o servidor está ocioso, quando não há servidor.
  await abrirProcessos(page);
  await expect(page.locator('[data-aviso-processos]')).toContainText('arquivo, não um servidor');
  await expect(page.locator('[data-total-processos]')).toHaveText('');
});

test('reabrir foca a MESMA aba, em vez de duplicar', async ({ page }) => {
  await abrirProcessos(page);
  await painelLateral(page, 'Database').click();
  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Ver processos/ }).click();
  await expect(aba(page, `Processos · ${CONEXAO}`)).toHaveCount(1);
});

test('a aba de processos NÃO mostra o ▷ da barra de abas', async ({ page }) => {
  // Mesmo defeito que a spec 043 encontrou na aba de tabela: o ▷ executaria o
  // editor do grupo, que guarda outro arquivo.
  await abrirProcessos(page);
  await expect(page.getByRole('button', { name: 'Executar consulta' })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Lote D: as divisórias, a cadência e o Structure Sync (T069, T070, T071)
//
// O SQLite continua sendo o alvo — é o que a suíte tem sem depender de rede. Ele
// não tem processos nem servidor, e é isso que torna estes testes possíveis:
// eles provam o que a IDE DIZ quando o banco não oferece o conceito, que é
// justamente onde este tipo de tela mente.
// ---------------------------------------------------------------------------

test('a aba tem as duas divisórias: Processos e Manager (T070)', async ({ page }) => {
  await abrirProcessos(page);
  await expect(page.locator('[data-divisoria-do-banco="processos"]')).toBeVisible();
  await expect(page.locator('[data-divisoria-do-banco="manager"]')).toBeVisible();
});

test('a atualização automática nasce DESLIGADA (T069)', async ({ page }) => {
  // O padrão é a decisão do item: cada leitura é uma consulta ao banco de
  // produção dele. Quem está caçando um processo travado liga.
  await abrirProcessos(page);
  const cadencia = page.locator('[data-cadencia]');
  if ((await cadencia.count()) === 0) return; // banco sem o conceito: nada a medir
  await expect(cadencia).toHaveValue('0');
  await expect(cadencia.locator('option')).toContainText(['sem atualizar']);
});

test('o Manager abre nas três divisórias que ele pediu (T070)', async ({ page }) => {
  await abrirProcessos(page);
  await page.locator('[data-divisoria-do-banco="manager"]').click();
  for (const id of ['dashboard', 'log', 'sync']) {
    await expect(page.locator(`[data-divisoria="${id}"]`)).toBeVisible();
  }
});

test('o Structure Sync DIZ que não executa nada (T070)', async ({ page }) => {
  // É a decisão que define o item, e ela precisa estar na tela — não só no
  // código. Comparar e aplicar são gestos diferentes.
  await abrirProcessos(page);
  await page.locator('[data-divisoria-do-banco="manager"]').click();
  await page.locator('[data-divisoria="sync"]').click();
  await expect(page.locator('[data-divisoria="sync"]').locator('..').locator('..'))
    .toContainText('ela não executa nada');
});

test('o botão de matar em lote SÓ aparece com algo marcado (T071)', async ({ page }) => {
  // Um botão vermelho permanente numa tela de produção é um convite ao
  // acidente.
  await abrirProcessos(page);
  await expect(page.locator('[data-matar-lote]')).toHaveCount(0);
});
