// A sub-aba Monitor (spec 056).
//
// Contra o `sshd` descartável da suíte, que roda na própria máquina — então os
// números são os desta máquina, e o que se afirma é a FORMA: que mediu, que
// repartiu a CPU, que listou processos e que parou quando saiu de vista.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import { destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';

async function abrirMonitor(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(page.locator('[data-sub-aba="monitor"]')).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o Monitor existe agora que a sessão sabe se medir', async ({ page }) => {
  await abrirMonitor(page);
  // Era a divisória que não aparecia até a spec 056 — a prova de que elas
  // saem das capacidades, e não de uma lista fixa.
  await expect(page.locator('[data-cartao="cpu"]')).toBeVisible();
  await expect(page.locator('[data-cartao="memoria"]')).toBeVisible();
  await expect(page.locator('[data-cartao="disco"]')).toBeVisible();
});

test('memória e disco medem já na PRIMEIRA amostra; CPU precisa de duas', async ({ page }) => {
  await abrirMonitor(page);
  // Porcentagem de CPU é diferença entre contadores: a primeira leitura não
  // tem com o que comparar, e a tela diz `--` em vez de um zero convincente.
  await expect(page.locator('[data-valor="memoria"]')).toContainText('%', { timeout: 20_000 });
  await expect(page.locator('[data-valor="disco"]')).toContainText('%');
  // E na segunda amostra a CPU aparece.
  await expect(page.locator('[data-valor="cpu"]')).toContainText('%', { timeout: 20_000 });
});

test('o top de processos lista, e a ordem troca entre CPU e memória', async ({ page }) => {
  await abrirMonitor(page);
  await expect(page.locator('[data-processo]').first()).toBeVisible({ timeout: 20_000 });

  const porMemoria = await page.locator('[data-processo]').first().textContent();
  await page.locator('[data-ordem="cpu"]').click();
  await expect(page.locator('[data-processo]').first()).toBeVisible();
  // Não se afirma QUAL processo lidera — isso depende da máquina. Afirma-se que
  // o botão existe e que a lista continua de pé depois de trocar.
  expect(porMemoria).not.toBeNull();
});

test('o uptime e a carga aparecem', async ({ page }) => {
  await abrirMonitor(page);
  await expect(page.locator('[data-uptime]')).toContainText('Up', { timeout: 20_000 });
  await expect(page.locator('[data-uptime]')).toContainText('carga');
});

test('o gráfico de rede aparece e ganha ponto com o tempo', async ({ page }) => {
  await abrirMonitor(page);
  await expect(page.locator('[data-grafico-de-rede]')).toBeVisible();
  // A taxa só existe a partir da SEGUNDA amostra — é diferença de contador.
  await expect(page.locator('[data-rede-taxa]')).toContainText('/s', { timeout: 20_000 });
});

test('sair da sub-aba PARA de medir', async ({ page }) => {
  await abrirMonitor(page);
  await expect(page.locator('[data-valor="cpu"]')).toContainText('%', { timeout: 20_000 });

  let pedidos = 0;
  page.on('request', (r) => {
    if (r.url().includes('/metrics')) pedidos += 1;
  });

  await page.locator('[data-sub-aba="sftp"]').click();
  await page.waitForTimeout(3_000);
  // Um relógio que sobrevive à troca de aba mediria um servidor que ninguém
  // está olhando — a cada segundo, para sempre.
  expect(pedidos).toBe(0);
});

test('a taxa de rede sai arredondada, e não com treze casas', async ({ page }) => {
  // `265.748031496063 B/s` — a taxa é uma divisão, e saía crua. Visto no
  // navegador (spec 056).
  await abrirMonitor(page);
  await expect(page.locator('[data-rede-taxa]')).toContainText('/s', { timeout: 20_000 });
  const texto = (await page.locator('[data-rede-taxa]').textContent()) ?? '';
  expect(texto).not.toMatch(/\d\.\d{4,}/);
});
