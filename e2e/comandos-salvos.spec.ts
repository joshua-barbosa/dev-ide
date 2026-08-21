// Comandos salvos e descobertos (spec 018).
//
// Os salvos são globais e ficam em disco, então cada teste remove o que criou —
// senão a lista cresceria entre execuções e os testes veriam entradas que não
// criaram.
import { expect, test, type Page } from '@playwright/test';
import { aba, entradaRapida, menu, esperarIdePronta } from './fixtures';

async function abrirCaixa(page: Page): Promise<void> {
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: /Run Task/ }).click();
  await expect(entradaRapida(page)).toBeVisible();
}

async function limparSalvos(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const r = await fetch('/api/commands');
    const { salvos } = (await r.json()).data as { salvos: { id: string }[] };
    for (const c of salvos) await fetch(`/api/commands/${c.id}`, { method: 'DELETE' });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test.afterEach(async ({ page }) => {
  await limparSalvos(page);
});

test('os scripts do package.json da pasta aberta aparecem na lista', async ({ page }) => {
  // A pasta `demo` da suíte ganha um manifesto, pela própria IDE.
  await page.evaluate(() =>
    fetch('/api/workspace/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'package.json',
        content: JSON.stringify({ scripts: { 'tarefa-de-teste': 'echo oi' } }, null, 2),
      }),
    })
  );

  await abrirCaixa(page);
  const item = page.getByRole('option', { name: /tarefa-de-teste/ });
  await expect(item).toBeVisible();
  // A origem aparece: descoberto não é a mesma coisa que salvo.
  await expect(item).toContainText('package.json');
  await expect(item).toContainText('npm run tarefa-de-teste');
});

test('salvar um comando e vê-lo na lista, marcado como salvo', async ({ page }) => {
  await abrirCaixa(page);
  await page.getByRole('option', { name: /Salvar um comando novo/ }).click();

  await entradaRapida(page).fill('meu-comando');
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill('echo COMANDO-SALVO-OK');
  await page.keyboard.press('Enter');
  // Não há mais pergunta de destino: só existe um (spec 039, decisão D3).

  // O aviso sobre texto puro é parte do que se deve ao usuário.
  await expect(page.getByRole('dialog')).toContainText('texto puro');
  await page.getByRole('button', { name: /ok|fechar/i }).click();

  await abrirCaixa(page);
  await expect(page.getByRole('option', { name: /meu-comando/ })).toContainText('salvo');
});

test('rodar um comando de shell abre um terminal e executa', async ({ page }) => {
  await abrirCaixa(page);
  await page.getByRole('option', { name: /Salvar um comando novo/ }).click();
  await entradaRapida(page).fill('marca-executada');
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill('echo EXECUTADO-PELO-COMANDO-SALVO');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /ok|fechar/i }).click();

  await abrirCaixa(page);
  await page.getByRole('option', { name: /marca-executada/ }).click();

  const terminal = page.locator('[data-terminal="shell"]');
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText('EXECUTADO-PELO-COMANDO-SALVO', { timeout: 20_000 });
});

test('não há mais destino SQL a escolher', async ({ page }) => {
  // O destino `sql` saiu na spec 039 (decisão D3): a pasta `Query` da spec 038
  // já guarda query por conexão e database, com nome, arquivo e lugar na
  // árvore. Dois lugares para guardar uma query é como eles divergem.
  //
  // O teste que existia aqui provava que um comando SQL ABRIA sem executar.
  // Fica no lugar dele o que garante que ninguém consegue criar um: o caminho
  // de salvar não pergunta mais nada depois do texto.
  await abrirCaixa(page);
  await page.getByRole('option', { name: /Salvar um comando novo/ }).click();
  await entradaRapida(page).fill('so-shell');
  await page.keyboard.press('Enter');
  await entradaRapida(page).fill('echo oi');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('option', { name: /Consulta \(SQL\)/ })).toHaveCount(0);
  // Vai direto para o aviso, sem passar por escolha de destino.
  await expect(page.getByRole('dialog')).toContainText('texto puro');
});

test('nome repetido é recusado pela rota', async ({ page }) => {
  const resposta = await page.evaluate(async () => {
    const criar = (nome: string) =>
      fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, comando: 'echo x', destino: 'shell' }),
      }).then((r) => r.json());
    await criar('repetido');
    return (await criar('REPETIDO')) as { success: boolean; error: string | null };
  });

  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/Já existe/);
});

test('o terminal nasce na pasta aberta, e não na de projetos', async ({ page }) => {
  // Sem isso, `npm run build` rodaria no projeto errado — ou em nenhum.
  await menu(page, 'Terminal');
  await page.getByRole('menuitem', { name: 'New Terminal' }).click();

  const terminal = page.locator('[data-terminal="shell"]');
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 15_000 });
  await terminal.click();
  await page.keyboard.type('pwd');
  await page.keyboard.press('Enter');

  await expect(terminal).toContainText(/projects\/demo/, { timeout: 15_000 });
});
