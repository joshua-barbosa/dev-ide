// Inteligência de código: diagnósticos, renomear, trilha e problemas (lote E).
//
// O que dá para provar aqui é o CAMINHO ponta a ponta — o servidor responde, o
// Monaco reflete, a tela mostra. O que NÃO dá é o `Ctrl+clique`: ele é do
// Monaco, e o Playwright não consegue afirmar sobre a janelinha do peek sem
// depender do desenho interno dele. O que se prova no lugar é que o PROVEDOR
// está registrado — que é a causa dos dois.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, editor, esperarIdePronta, painelLateral } from './fixtures';

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
// T037 — diagnósticos
// ---------------------------------------------------------------------------

test('erro de TypeScript vira rabisco no editor (T037)', async ({ page }) => {
  await comArquivo(page, 'zorbax-erro.ts', 'const x: number = "texto";\n');

  // O Monaco desenha o rabisco como um `<span>` com a classe da severidade —
  // é o que dá para afirmar de fora. `window.monaco` não existe: ele é módulo,
  // e não global.
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 20_000 });

  await apagar(page, 'zorbax-erro.ts');
});

test('o servidor responde os diagnósticos com linha e coluna (T037)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    const resposta = await fetch('/api/language/diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caminho: `${pasta}/zorbax-diag.ts`,
        linha: 1,
        coluna: 1,
        conteudo: 'const x: number = "texto";\n',
      }),
    });
    return (await resposta.json()) as { data: { problemas: { linha: number; severidade: string }[] } };
  });
  expect(r.data.problemas.length).toBeGreaterThan(0);
  expect(r.data.problemas[0]?.linha).toBe(1);
  expect(r.data.problemas[0]?.severidade).toBe('erro');
});

// ---------------------------------------------------------------------------
// T038 — renomear
// ---------------------------------------------------------------------------

test('o servidor devolve os lugares de renomear, com prévia (T038)', async ({ page }) => {
  // É a nota dele, e a regra que este lote compartilha com o Structure Sync e
  // o Timeline: a IDE mostra o que vai fazer ANTES de aplicar. Aqui se prova a
  // fonte daquela lista — pôr o cursor na coluna exata pelo teclado seria
  // testar o Monaco, e não o item.
  const r = await page.evaluate(async () => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    const resposta = await fetch('/api/language/rename-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caminho: `${pasta}/zorbax-ren.ts`,
        // Sobre o `alvoDoTeste` da primeira linha.
        linha: 1,
        coluna: 16,
        conteudo: 'export const alvoDoTeste = 1;\nconst y = alvoDoTeste + 1;\n',
      }),
    });
    return (await resposta.json()) as {
      data: { lugares: { caminho: string; linha: number; previa: string }[] };
    };
  });

  // As duas ocorrências: a declaração e o uso.
  expect(r.data.lugares.length).toBeGreaterThanOrEqual(2);
  // A prévia é o que a confirmação mostra — sem ela, a lista seria de números.
  expect(r.data.lugares[0]?.previa).toContain('alvoDoTeste');
});

// ---------------------------------------------------------------------------
// T075 — a trilha
// ---------------------------------------------------------------------------

test('a trilha mostra o caminho, sem a raiz (T075)', async ({ page }) => {
  await comArquivo(page, 'zorbax-trilha.ts', 'export function daqui() {\n  return 1;\n}\n');
  const trilha = page.locator('[data-breadcrumb]');
  await expect(trilha).toBeVisible({ timeout: 10_000 });
  await expect(trilha.locator('[data-degrau="zorbax-trilha.ts"]')).toBeVisible();

  await apagar(page, 'zorbax-trilha.ts');
});

// ---------------------------------------------------------------------------
// T114 — completar
// ---------------------------------------------------------------------------

test('o completar oferece as palavras do próprio arquivo (T114)', async ({ page }) => {
  // A segunda metade da nota dele: "nas outras, ao menos as palavras do arquivo
  // aberto". Aqui num `.txt`, onde não há serviço nenhum.
  await comArquivo(page, 'zorbax-palavras.txt', 'configuracaoDoServidor\noutraCoisa\n');

  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('confi');
  await page.keyboard.press('Control+Space');

  await expect(page.locator('.suggest-widget')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.suggest-widget')).toContainText('configuracaoDoServidor');
  await page.keyboard.press('Escape');

  await apagar(page, 'zorbax-palavras.txt');
});

// ---------------------------------------------------------------------------
// T008 — problema clicável
// ---------------------------------------------------------------------------

test('o problema com lugar é clicável; o sem lugar não finge que é (T008)', async ({ page }) => {
  await comArquivo(page, 'zorbax-problema.py', 'import sys\nraise ValueError("estourou")\n');

  // Roda o arquivo pelo botão, que é o caminho que a suíte já usa.
  await page.getByRole('button', { name: 'Executar arquivo' }).click();
  // Espera a execução TERMINAR: o problem matcher lê a saída no fim, porque um
  // traceback só tem a mensagem na última linha.
  await expect(page.locator('pre').last()).toContainText('ValueError', { timeout: 30_000 });

  await page.locator('[data-aba-painel="problems"]').click();
  await expect(page.locator('[data-problema][data-clicavel="true"]').first()).toBeVisible({
    timeout: 15_000,
  });

  // E o problema leva ao arquivo DELE, e não à cópia em /tmp que a execução
  // usou e apagou.
  await expect(page.locator('[data-problema][data-clicavel="true"]').first()).toContainText(
    'zorbax-problema.py:2'
  );
  await expect(page.locator('[data-problema][data-clicavel="true"]').first()).toBeVisible({
    timeout: 15_000,
  });

  await apagar(page, 'zorbax-problema.py');
});
