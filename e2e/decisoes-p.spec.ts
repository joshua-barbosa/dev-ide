// As quatro decisões dele de 02/09/2026 (P2, P3, P4, P5).
//
// A P1 não tem teste porque a resposta foi NÃO: *"Deixa o ordenar para a query
// mesmo"*. Um teste de que algo não existe passaria por engano em mil motivos
// diferentes, e nenhum deles seria o item.
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, esperarIdePronta } from './fixtures';

const RODADA = Date.now().toString(36);
let proximo = 0;
const novoNome = (ext: string): string => `p-${RODADA}-${(proximo += 1)}.${ext}`;

/**
 * Cria o arquivo pela API e o abre pela ÁRVORE.
 *
 * Pela API, e não digitando no editor: um `.csv` criado como "New Text File"
 * nasce numa aba de TEXTO, e o que este teste precisa é da aba de GRADE — que é
 * a que a árvore abre.
 */
async function comCsv(page: Page, nome: string, conteudo: string): Promise<void> {
  await page.evaluate(
    async ([n, c]) => {
      const w = await fetch('/api/workspace');
      const { pasta } = (await w.json()).data as { pasta: string };
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

async function lerDoDisco(page: Page, nome: string): Promise<string> {
  return page.evaluate(async (n) => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    const r = await fetch(`/api/file?path=${encodeURIComponent(`${pasta}/${n}`)}`);
    return ((await r.json()).data as { content: string }).content;
  }, nome);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

// ---------------------------------------------------------------------------
// P5 — editar CSV pela grade
// ---------------------------------------------------------------------------

test('editar uma célula do CSV suja a aba, e o Ctrl+S grava (P5)', async ({ page }) => {
  const nome = novoNome('csv');
  await comCsv(page, nome, 'nome,idade\nana,30\nbia,41\n');

  const grade = page.locator('[data-visualizador="csv"]');
  await expect(grade).toBeVisible({ timeout: 15_000 });

  // A célula da idade da ana.
  const celula = grade.locator('td').filter({ hasText: /^30$/ }).first();
  await celula.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('31');
  await page.keyboard.press('Enter');

  // A aba fica SUJA: editar não é salvar, aqui como em qualquer arquivo.
  await expect(page.locator(`[data-tab="${nome}"]`)).toHaveAttribute(
    'data-tab-dirty', 'true', { timeout: 10_000 }
  );

  await page.keyboard.press('Control+s');
  await expect(page.locator(`[data-tab="${nome}"]`)).toHaveAttribute(
    'data-tab-dirty', 'false', { timeout: 10_000 }
  );

  // E o que foi para o disco é o CSV inteiro, com só aquela célula trocada.
  expect(await lerDoDisco(page, nome)).toBe('nome,idade\nana,31\nbia,41\n');
});

test('duas linhas IDÊNTICAS não se confundem: a identidade é a posição (P5)', async ({ page }) => {
  // É a razão de a spec 044 exigir chave primária, e a razão de o CSV usar a
  // posição no lugar dela.
  const nome = novoNome('csv');
  await comCsv(page, nome, 'valor\nigual\nigual\n');

  const grade = page.locator('[data-visualizador="csv"]');
  await expect(grade).toBeVisible({ timeout: 15_000 });

  // A SEGUNDA das duas.
  await grade.locator('td').filter({ hasText: /^igual$/ }).nth(1).dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('mudou');
  await page.keyboard.press('Enter');

  // Espera a troca chegar na ABA antes de salvar: sem isto o Ctrl+S grava o
  // conteúdo velho, e o teste passaria ou falharia pelo relógio.
  await expect(page.locator(`[data-tab="${nome}"]`)).toHaveAttribute(
    'data-tab-dirty', 'true', { timeout: 10_000 }
  );
  await page.keyboard.press('Control+s');
  await expect(page.locator(`[data-tab="${nome}"]`)).toHaveAttribute(
    'data-tab-dirty', 'false', { timeout: 10_000 }
  );

  expect(await lerDoDisco(page, nome)).toBe('valor\nigual\nmudou\n');
});

// ---------------------------------------------------------------------------
// O PDF (defeito relatado em 02/09/2026: "PDF não abriu")
// ---------------------------------------------------------------------------

test('o PDF é servido como PDF, e o quadro NÃO é sandbox', async ({ page }) => {
  // O `sandbox` do quadro era o que impedia o Chrome de instanciar o próprio
  // visualizador de PDF. Quem garante a segurança aqui é o SERVIDOR: o tipo sai
  // de uma tabela nossa e vai com `nosniff`, então um arquivo nunca vira HTML.
  //
  // O DESENHO do PDF não dá para afirmar daqui — o Chromium do Playwright não
  // traz o visualizador. O que se prova é o contrato: os cabeçalhos certos e a
  // ausência do atributo que quebrava.
  const nome = novoNome('pdf');
  // Um PDF mínimo, escrito à mão: não depende de nenhum arquivo de fixture.
  await page.evaluate(async (n) => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${pasta}/${n}`,
        content: '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
      }),
    });
  }, nome);
  await abrirArquivo(page, nome);

  const quadro = page.locator('[data-visualizador="pdf"]');
  await expect(quadro).toBeVisible({ timeout: 10_000 });
  await expect(quadro).not.toHaveAttribute('sandbox', /.*/);

  const cabecalhos = await page.evaluate(async (n) => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    const r = await fetch(`/api/file/raw?path=${encodeURIComponent(`${pasta}/${n}`)}`);
    return {
      status: r.status,
      tipo: r.headers.get('content-type'),
      nosniff: r.headers.get('x-content-type-options'),
    };
  }, nome);

  expect(cabecalhos.status).toBe(200);
  expect(cabecalhos.tipo).toBe('application/pdf');
  // É ESTE cabeçalho que substitui o sandbox: sem ele, o navegador poderia
  // adivinhar outro tipo e tratar o arquivo como script.
  expect(cabecalhos.nosniff).toBe('nosniff');
});
