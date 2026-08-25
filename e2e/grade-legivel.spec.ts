// A grade legível (spec 062).
//
// Fase A: o painel de tabela vazava para FORA da tela.
//
// Este arquivo existe por causa do buraco que deixou o defeito passar. O botão
// `Executar este SQL` existe desde a spec 043 e tem rótulo certo — e
// `getByLabel(...).click()` PASSA num elemento fora da tela, porque o Playwright
// rola até ele antes de clicar. Então o teste não pergunta se o botão existe:
// ele MEDE onde o botão está.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, TABELA).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

/**
 * Uma consulta larga o bastante para estourar qualquer tela.
 *
 * Doze colunas de texto longo: com o teto de 420 px por coluna, são mais de
 * 5000 px de tabela. O `escola.db` de teste tem três colunas curtas, e com elas
 * o defeito não aparece — foi por isso que nenhum teste o pegou.
 */
const SQL_LARGO = `select ${Array.from(
  { length: 12 },
  (_, i) => `'${'x'.repeat(70)}' as coluna_bem_comprida_${i}`
).join(', ')}`;

/** Tudo que a aba desenha precisa caber na largura de quem a contém. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const painel = document.querySelector('[data-aba-de-tabela]') as HTMLElement;
    const grade = painel.querySelector('[data-grade]') as HTMLElement;
    const pai = painel.parentElement as HTMLElement;
    // Só a MOLDURA da aba: o SQL, a barra de comando, a paginação. O que está
    // DENTRO da grade pode estar fora de vista com toda a razão — é o que
    // "rolar na horizontal" significa. Confundir os dois faria o teste exigir
    // que a tabela larga não rolasse, que é o defeito ao contrário.
    const fora = [...painel.querySelectorAll('button')]
      .filter((b) => grade === null || !grade.contains(b))
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth || r.left < 0);
      })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '?');
    return {
      larguraDoPainel: Math.round(painel.getBoundingClientRect().width),
      larguraQueCabe: pai.clientWidth,
      gradeRola: grade.scrollWidth > grade.clientWidth,
      fora,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a tabela larga rola por dentro, e o painel não vaza para fora da tela', async ({ page }) => {
  await abrirTabela(page);

  // `Ctrl+Enter` porque é o gesto que sobrevive ao defeito: o botão de executar
  // é justamente o que caía fora da tela.
  await page.locator('[data-sql-da-tabela]').fill(SQL_LARGO);
  await page.locator('[data-sql-da-tabela]').press('Control+Enter');
  await expect(page.locator('[data-modo-livre]')).toBeVisible();
  // A grade só nasce quando o resultado chega: antes dela existe o "carregando…".
  await expect(page.locator('[data-grade]')).toBeVisible();

  const m = await medir(page);
  // A grade PRECISA estar rolando — sem isso o teste passaria numa tabela
  // estreita e não estaria provando nada.
  expect(m.gradeRola).toBe(true);
  expect(m.larguraDoPainel).toBeLessThanOrEqual(m.larguraQueCabe);
});

test('nenhum controle da aba de tabela fica fora da tela', async ({ page }) => {
  await abrirTabela(page);
  await page.locator('[data-sql-da-tabela]').fill(SQL_LARGO);
  await page.locator('[data-sql-da-tabela]').press('Control+Enter');
  await expect(page.locator('[data-modo-livre]')).toBeVisible();
  await expect(page.locator('[data-grade]')).toBeVisible();

  expect((await medir(page)).fora).toEqual([]);
});
