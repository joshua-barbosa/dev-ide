// O disco mudando por fora da IDE (spec 037).
//
// O vigia em si é testado sem navegador, contra o `inotify` de verdade, em
// `server/__tests__/vigia.test.ts`. Aqui se prova o que ele causa na tela — e
// principalmente o caso que motivou tudo: a aba com trabalho não salvo NÃO é
// sobrescrita sem perguntar.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { abrirArquivo, editor, esperarEditorPronto, linhaArvore, menu, textoDoEditor, esperarIdePronta } from './fixtures';
import { PASTA_DEMO } from './global-setup';

const demo = (): string => PASTA_DEMO(process.env.E2E_DATA ?? '');

/** Escreve no disco POR FORA da IDE, como faria outro programa. */
function porFora(nome: string, conteudo: string): void {
  fs.writeFileSync(path.join(demo(), nome), conteudo);
}

/**
 * Espera o canal do vigia estar de pé.
 *
 * Ele conecta num efeito, depois da primeira pintura: escrever no disco antes
 * disso perde o aviso, e o teste falha por corrida em vez de por defeito.
 */
async function comVigiaDePe(page: import('@playwright/test').Page): Promise<void> {
  const conectado = page.waitForEvent('websocket', {
    predicate: (ws) => ws.url().includes('/api/watch'),
    timeout: 10_000,
  });
  await page.goto('/');
  await esperarIdePronta(page);
  await conectado;
  await expect(linhaArvore(page, 'utils.ts')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await comVigiaDePe(page);
});

test('arquivo criado por fora aparece na árvore sozinho', async ({ page }) => {
  const nome = `vigia-novo-${Date.now()}.txt`;
  await expect(linhaArvore(page, nome)).toHaveCount(0);

  porFora(nome, 'veio de fora');

  // Sem clicar em nada: é a diferença entre vigiar e ter um botão.
  await expect(linhaArvore(page, nome)).toBeVisible({ timeout: 10_000 });
});

test('arquivo removido por fora some da árvore sozinho', async ({ page }) => {
  const nome = `vigia-some-${Date.now()}.txt`;
  porFora(nome, 'x');
  await expect(linhaArvore(page, nome)).toBeVisible({ timeout: 10_000 });

  fs.rmSync(path.join(demo(), nome));
  await expect(linhaArvore(page, nome)).toHaveCount(0, { timeout: 10_000 });
});

test('a aba SEM alteração recebe o texto novo, calada', async ({ page }) => {
  const nome = `vigia-limpa-${Date.now()}.txt`;
  porFora(nome, 'antes');
  await expect(linhaArvore(page, nome)).toBeVisible({ timeout: 10_000 });
  await abrirArquivo(page, nome);
  await expect.poll(() => textoDoEditor(page)).toContain('antes');

  porFora(nome, 'depois, vindo de fora');

  // Não há duas versões: há uma só, e ela está no disco.
  await expect.poll(() => textoDoEditor(page), { timeout: 10_000 })
    .toContain('depois, vindo de fora');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a aba COM alteração NÃO é sobrescrita, e salvar pergunta antes', async ({ page }) => {
  // É o defeito que motivou a spec: salvar apagava o que veio de fora, calado.
  const nome = `vigia-suja-${Date.now()}.txt`;
  porFora(nome, 'original\n');
  await expect(linhaArvore(page, nome)).toBeVisible({ timeout: 10_000 });
  await abrirArquivo(page, nome);
  await esperarEditorPronto(page);

  await page.keyboard.press('Control+End');
  await page.keyboard.type('minha edicao');
  porFora(nome, 'veio de fora e nao pode sumir\n');

  // O aviso vai para `Problems`, que é onde o usuário procura o que deu errado.
  await expect(page.getByRole('tab', { name: /Problems/ })).toContainText('1', {
    timeout: 10_000,
  });
  // E o que está na tela é o meu, e continua sendo.
  await expect.poll(() => textoDoEditor(page)).toContain('minha edicao');

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();

  const caixa = page.getByRole('dialog');
  await expect(caixa).toContainText('mudou em disco');
  await caixa.getByRole('button', { name: /cancelar/i }).click();

  // Cancelou: o disco continua com o que veio de fora.
  expect(fs.readFileSync(path.join(demo(), nome), 'utf8')).toContain('veio de fora');
});

test('confirmando, a versão da tela vence', async ({ page }) => {
  const nome = `vigia-vence-${Date.now()}.txt`;
  porFora(nome, 'original\n');
  await expect(linhaArvore(page, nome)).toBeVisible({ timeout: 10_000 });
  await abrirArquivo(page, nome);
  await esperarEditorPronto(page);

  await page.keyboard.press('Control+End');
  await page.keyboard.type('a minha versao');
  porFora(nome, 'a de fora\n');
  await expect(page.getByRole('tab', { name: /Problems/ })).toContainText('1', {
    timeout: 10_000,
  });

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /sobrescrever/i }).click();

  await expect
    .poll(() => fs.readFileSync(path.join(demo(), nome), 'utf8'), { timeout: 10_000 })
    .toContain('a minha versao');
});

test('mudança dentro de node_modules NÃO mexe na IDE', async ({ page }) => {
  // O vigia usa as mesmas regras da varredura: um `npm install` não pode virar
  // uma tempestade de avisos sobre o que a IDE nem indexa.
  await abrirArquivo(page, 'utils.ts');
  const antes = await textoDoEditor(page);

  fs.writeFileSync(path.join(demo(), 'node_modules', 'ruido.js'), `x${Date.now()}`);
  await page.waitForTimeout(1_500);

  await expect(page.getByRole('tab', { name: /Problems/ })).not.toContainText('1');
  expect(await textoDoEditor(page)).toBe(antes);
});
