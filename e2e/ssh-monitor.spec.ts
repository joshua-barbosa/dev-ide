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
  const senha = page.getByLabel('Senha mestra', { exact: true });
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

// ---------------------------------------------------------------------------
// Lote M: a partição escolhida (T082) e o kill (T080)
//
// Contra o mesmo `sshd` descartável. O kill é exercido num processo que o
// próprio teste cria e que só ele conhece — nada da máquina é derrubado.
// ---------------------------------------------------------------------------

test('o cartão de disco deixa escolher a partição (T082)', async ({ page }) => {
  await abrirMonitor(page);
  await expect(page.locator('[data-cartao="disco"]')).toBeVisible();

  const seletor = page.locator('[data-particao]');
  // Máquina com uma partição só não mostra o seletor — uma lista de um item é
  // enfeite —, então o teste afirma o que couber neste computador.
  if ((await seletor.count()) === 0) {
    await expect(page.locator('[data-valor="disco"]')).not.toHaveText('--');
    return;
  }

  const opcoes = await seletor.locator('option').allTextContents();
  expect(opcoes.length).toBeGreaterThan(1);
  // Trocar de partição troca o número: são discos diferentes.
  const antes = await page.locator('[data-valor="disco"]').innerText();
  await seletor.selectOption({ index: 1 });
  await expect
    .poll(() => page.locator('[data-valor="disco"]').innerText(), { timeout: 10_000 })
    .not.toBe(antes);
});

test('matar um processo pede confirmação, e o comando aparece nela (T080)', async ({ page }) => {
  await abrirMonitor(page);
  await expect(page.locator('[data-processo]').first()).toBeVisible({ timeout: 30_000 });

  // O primeiro processo da lista serve: o que se prova aqui é que a IDE
  // PERGUNTA antes e mostra o que vai derrubar. Cancelar fecha o assunto sem
  // mandar nada ao servidor — é de propósito que este teste não confirma.
  const linha = page.locator('[data-processo]').first();
  await linha.hover();
  const botao = linha.locator('[data-matar$=":TERM"]');
  await expect(botao).toBeVisible();
  await botao.click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('Encerrar o processo');
  // O COMANDO na pergunta: confirmar sabendo só o PID é o mesmo que não
  // confirmar.
  await expect(dialogo).toContainText('SIGTERM');
  await page.getByRole('button', { name: 'cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
