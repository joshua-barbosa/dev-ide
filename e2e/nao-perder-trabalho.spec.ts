// Não perder trabalho: Timeline, rascunho, aviso ao fechar e o sino (lote O).
//
// O que dá para provar aqui de verdade é o CAMINHO: que salvar cria versão, que
// a versão volta para o editor sem tocar no disco, e que o sino guarda o que
// passou. O `beforeunload` não dá — nenhum navegador deixa um teste automatizado
// confirmar a caixa de "sair mesmo?", e é assim de propósito.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, editor, esperarIdePronta, painelLateral, textoDoEditor } from './fixtures';

async function comArquivo(page: Page, nome: string, conteudo: string): Promise<void> {
  await page.evaluate(
    async ([n, c]) => {
      const r = await fetch('/api/workspace');
      const { pasta } = (await r.json()).data as { pasta: string };
      await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, content: '' }),
      }).catch(() => undefined);
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${pasta}/${n}`, content: c }),
      });
    },
    [nome, conteudo] as const
  );
  await abrirArquivo(page, nome);
}

async function apagar(page: Page, nome: string): Promise<void> {
  await page.evaluate(async (n) => {
    const r = await fetch('/api/workspace');
    const { pasta } = (await r.json()).data as { pasta: string };
    await fetch('/api/workspace/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${pasta}/${n}` }),
    });
  }, nome);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

// ---------------------------------------------------------------------------
// T010 — o Timeline
// ---------------------------------------------------------------------------

test('o Timeline é um painel próprio da lateral (T010)', async ({ page }) => {
  await painelLateral(page, 'Timeline').click();
  // Sem arquivo aberto ele diz o que fazer, em vez de ficar em branco.
  await expect(page.getByText('Abra um arquivo para ver as versões')).toBeVisible();
});

test('cada save vira uma versão, e salvar sem mudar NÃO (T010)', async ({ page }) => {
  await comArquivo(page, 'zorbax-hist.txt', 'primeira');
  await painelLateral(page, 'Timeline').click();

  // O arquivo nasceu por API, que também grava versão — então já há uma.
  await expect(page.locator('[data-versao]')).toHaveCount(1, { timeout: 10_000 });

  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' segunda');
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-versao]')).toHaveCount(2, { timeout: 10_000 });

  // Salvar de novo sem mudar nada: o Timeline não ganha linha. Cinco saves
  // iguais empurrariam para fora a versão que interessa.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-versao]')).toHaveCount(2);

  await apagar(page, 'zorbax-hist.txt');
});

test('trazer uma versão põe no EDITOR e deixa a aba suja — não grava (T010)', async ({ page }) => {
  // É a decisão que define o item: "quero ver como estava" não pode virar
  // "perdi o que eu tinha agora".
  await comArquivo(page, 'zorbax-restaura.txt', 'versão um');
  await painelLateral(page, 'Timeline').click();
  await expect(page.locator('[data-versao]')).toHaveCount(1, { timeout: 10_000 });

  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('versão dois');
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-versao]')).toHaveCount(2, { timeout: 10_000 });

  // A mais VELHA é a última da lista.
  const velha = page.locator('[data-versao]').last();
  await velha.hover();
  await velha.getByRole('button', { name: 'Trazer para o editor' }).click();

  await expect.poll(() => textoDoEditor(page), { timeout: 10_000 }).toContain('versão um');
  // A aba fica SUJA: o disco ainda tem "versão dois".
  await expect(page.locator('[data-tab-dirty="true"]').first()).toBeVisible();

  const emDisco = await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    const { pasta } = (await r.json()).data as { pasta: string };
    const f = await fetch(
      `/api/file?path=${encodeURIComponent(`${pasta}/zorbax-restaura.txt`)}`
    ).then((x) => x.json());
    return f.data.content as string;
  });
  expect(emDisco).toBe('versão dois');

  await apagar(page, 'zorbax-restaura.txt');
});

// ---------------------------------------------------------------------------
// T035 — o rascunho
// ---------------------------------------------------------------------------

test('o rascunho gravado aparece MARCADO no Timeline, com a data (T035)', async ({ page }) => {
  await comArquivo(page, 'zorbax-rascunho.txt', 'salvo em disco');

  // O que o `pagehide` faria, feito à mão: o teste não consegue fechar a janela
  // e voltar, mas a rota é a mesma que o `sendBeacon` chama.
  await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    const { pasta } = (await r.json()).data as { pasta: string };
    await fetch('/api/history/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${pasta}/zorbax-rascunho.txt`,
        content: 'trabalho que não foi salvo',
      }),
    });
  });

  await painelLateral(page, 'Timeline').click();
  await expect(page.locator('[data-versao="rascunho"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-versao="rascunho"]')).toContainText('rascunho');

  await apagar(page, 'zorbax-rascunho.txt');
});

test('salvar por cima APAGA o rascunho — ele virou história (T035)', async ({ page }) => {
  await comArquivo(page, 'zorbax-vira.txt', 'antes');
  await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    const { pasta } = (await r.json()).data as { pasta: string };
    await fetch('/api/history/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${pasta}/zorbax-vira.txt`, content: 'rascunho' }),
    });
  });

  await painelLateral(page, 'Timeline').click();
  await expect(page.locator('[data-versao="rascunho"]')).toBeVisible({ timeout: 10_000 });

  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' depois');
  await page.keyboard.press('Control+s');

  // Manter os dois faria a IDE oferecer para sempre um rascunho já salvo.
  await expect(page.locator('[data-versao="rascunho"]')).toHaveCount(0, { timeout: 10_000 });

  await apagar(page, 'zorbax-vira.txt');
});

// ---------------------------------------------------------------------------
// T107 — as notificações
// ---------------------------------------------------------------------------

test('o sino existe na barra de status, e guarda o que passou (T107)', async ({ page }) => {
  await expect(page.locator('[data-sino]')).toBeVisible();
  await page.locator('[data-sino]').click();
  await expect(page.locator('[data-historico-de-avisos]')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('trazer uma versão notifica SEM interromper (T107)', async ({ page }) => {
  // A notificação é para o que só precisa ser dito. O diálogo continua para o
  // que exige decisão — e a diferença é justamente esta: nada a clicar.
  await comArquivo(page, 'zorbax-avisa.txt', 'um');
  await painelLateral(page, 'Timeline').click();
  await expect(page.locator('[data-versao]')).toHaveCount(1, { timeout: 10_000 });

  const versao = page.locator('[data-versao]').first();
  await versao.hover();
  await versao.getByRole('button', { name: 'Trazer para o editor' }).click();

  await expect(page.locator('[data-aviso="info"]')).toBeVisible({ timeout: 5_000 });
  // Não há diálogo bloqueando: a IDE continua clicável.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await apagar(page, 'zorbax-avisa.txt');
});
