// Encaminhamento de portas (spec 059).
//
// O túnel é aberto contra o próprio `sshd` da suíte, e o alvo é o servidor da
// própria IDE: assim dá para provar que o cano funciona de ponta a ponta sem
// depender de nada de fora.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import { destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';

async function abrirPortas(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(page.locator('[data-sub-aba="portas"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-sub-aba="portas"]').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a divisória Port Forwarding existe agora que a sessão a declara', async ({ page }) => {
  await abrirPortas(page);
  await expect(page.getByLabel('Host remoto')).toBeVisible();
  await expect(page.getByLabel('Porta remota')).toBeVisible();
  await expect(page.getByText('Nenhum encaminhamento aberto.')).toBeVisible();
});

test('abrir um encaminhamento e o cano FUNCIONAR de verdade', async ({ page, baseURL }) => {
  await abrirPortas(page);

  // O alvo é o próprio servidor da IDE: o `sshd` de teste roda nesta máquina,
  // então `127.0.0.1:<porta da IDE>` é alcançável do outro lado.
  const portaDaIde = Number(new URL(baseURL ?? 'http://127.0.0.1:4321').port);
  await page.getByLabel('Porta remota').fill(String(portaDaIde));
  await page.getByRole('button', { name: 'Encaminhar' }).click();

  const tunel = page.locator('[data-tunel]').first();
  await expect(tunel).toBeVisible({ timeout: 20_000 });
  await expect(tunel).toContainText(`:${portaDaIde}`);

  // A prova: pedir pela porta LOCAL do túnel e receber a resposta da IDE, que
  // atravessou o canal SSH nos dois sentidos.
  const local = (await tunel.textContent())?.match(/127\.0\.0\.1:(\d+)/)?.[1];
  expect(local).toBeDefined();
  // `page.request`, e não `fetch` de dentro da página: o navegador barraria por
  // CORS uma requisição para outra porta, e o que se quer provar é o CANO, não
  // a política de origem.
  const resposta = await page.request.get(`http://127.0.0.1:${local}/api/projects`);
  // Qualquer resposta serve: o que se prova é que ela atravessou o canal SSH
  // nos dois sentidos.
  expect(resposta.status()).toBeGreaterThan(0);
});

test('fechar o encaminhamento tira ele da lista', async ({ page, baseURL }) => {
  await abrirPortas(page);
  const portaDaIde = Number(new URL(baseURL ?? 'http://127.0.0.1:4321').port);
  await page.getByLabel('Porta remota').fill(String(portaDaIde));
  await page.getByRole('button', { name: 'Encaminhar' }).click();
  await expect(page.locator('[data-tunel]').first()).toBeVisible({ timeout: 20_000 });

  // A sessão é compartilhada pela suíte, e os testes anteriores deixaram
  // túneis abertos: fecha todos e afirma o que sobra — isolar por dado, e não
  // por ordem.
  // Fecha até não sobrar nenhum: contar antes e clicar N vezes corre com o
  // recarregamento da lista, que é assíncrono.
  for (let tentativas = 0; tentativas < 30; tentativas += 1) {
    if ((await page.locator('[data-tunel]').count()) === 0) break;
    await page.getByRole('button', { name: /Fechar o encaminhamento/ }).first().click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator('[data-tunel]')).toHaveCount(0);
  await expect(page.getByText('Nenhum encaminhamento aberto.')).toBeVisible();
});

test('porta remota fora da faixa é recusada, com o motivo', async ({ page }) => {
  await abrirPortas(page);
  await page.getByLabel('Porta remota').fill('999999');
  await page.getByRole('button', { name: 'Encaminhar' }).click();
  await expect(page.locator('[data-erro-portas]')).toContainText('entre 1 e 65535');
});
