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
  const senha = page.getByLabel('Senha mestra', { exact: true });
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

// ---- Fase B: o botão de executar na barra de comando (T053 da triagem: D53) ----

const barra = (page: Page) => page.locator('[data-barra-de-comando]');

test('o botão de executar mora na barra de comando, e é colorido', async ({ page }) => {
  await abrirTabela(page);
  const executar = page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' });
  await expect(executar).toBeVisible();

  // Na barra, e não pendurado no canto do campo de SQL: é onde o olho já está
  // quando termina de editar a query.
  await expect(barra(page).getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' })).toBeVisible();

  // Colorido de propósito. A cor vem do tema, então o teste não fixa o valor —
  // exige apenas que NÃO seja a cor do texto em volta, que é o que o fazia
  // desaparecer no meio dos outros ícones.
  const [corDoBotao, corDaBarra] = await page.evaluate(() => {
    const b = document.querySelector('[data-barra-de-comando] button[aria-label^="Executar este SQL"]') as HTMLElement;
    const barraEl = document.querySelector('[data-barra-de-comando]') as HTMLElement;
    return [getComputedStyle(b).color, getComputedStyle(barraEl).color];
  });
  expect(corDoBotao).not.toBe(corDaBarra);
});

test('clicar no botão roda o SQL editado', async ({ page }) => {
  await abrirTabela(page);
  await page.locator('[data-sql-da-tabela]').fill('select 42 as resposta');
  await page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' }).click();

  await expect(page.locator('[data-modo-livre]')).toBeVisible();
  // Dentro da GRADE: desde o T059 o campo de SQL é colorido, e o `42` que ele
  // mostra também casa com o texto. É a mesma armadilha do `Ex-porta-r`.
  await expect(page.locator('[data-grade]').getByText('42', { exact: true })).toBeVisible();
});

test('o campo de SQL não tem mais botão pendurado no canto', async ({ page }) => {
  await abrirTabela(page);
  const noCampo = await page.evaluate(() =>
    document.querySelector('[data-sql-da-tabela]')!.parentElement!.querySelectorAll('button').length
  );
  expect(noCampo).toBe(0);
});

// ---- Fase C: largura de coluna arrastável (D54) ----

/** A largura que o navegador de fato pintou naquela coluna. */
const larguraDe = (page: Page, coluna: string) =>
  page.evaluate(
    (c) => Math.round(document.querySelector(`[data-coluna="${c}"]`)!.getBoundingClientRect().width),
    coluna
  );

test('arrastar a alça alarga SÓ aquela coluna', async ({ page }) => {
  await abrirTabela(page);
  const antesNome = await larguraDe(page, 'nome');
  const antesId = await larguraDe(page, 'id');

  const alca = page.locator('[data-alca="nome"]');
  const caixa = (await alca.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.down();
  // Em dois passos: o navegador só dispara `mousemove` quando o ponteiro anda,
  // e um salto único às vezes chega como um evento só, escondendo defeito de
  // acumulação.
  await page.mouse.move(caixa.x + 60, caixa.y + caixa.height / 2);
  await page.mouse.move(caixa.x + 120, caixa.y + caixa.height / 2);
  await page.mouse.up();

  expect(await larguraDe(page, 'nome')).toBeGreaterThan(antesNome + 80);
  // A vizinha não se mexeu: é o que o `table-layout: fixed` garante, e o que
  // faltaria se a tabela continuasse se redistribuindo sozinha.
  expect(await larguraDe(page, 'id')).toBe(antesId);
});

test('a coluna não encolhe abaixo do mínimo, por mais que se arraste', async ({ page }) => {
  await abrirTabela(page);
  const alca = page.locator('[data-alca="nome"]');
  const caixa = (await alca.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, caixa.y + caixa.height / 2);
  await page.mouse.move(0, caixa.y + caixa.height / 2);
  await page.mouse.up();

  // 48 é o mínimo do módulo puro; o que o DOM devolve inclui o preenchimento e
  // as bordas do cabeçalho, então a faixa é generosa de propósito. O que este
  // teste guarda é que existe uma parede — não qual é o pixel exato dela.
  const encolhida = await larguraDe(page, 'nome');
  expect(encolhida).toBeGreaterThanOrEqual(48);
  expect(encolhida).toBeLessThan(75);
});

test('duplo clique na alça devolve a coluna ao tamanho do conteúdo', async ({ page }) => {
  await abrirTabela(page);
  // Agora que a coluna NASCE ajustada ao conteúdo, o duplo clique é o desfazer
  // do arrasto — e é isso que precisa estar guardado. A primeira versão deste
  // teste dizia "ajustar encolhe", o que só era verdade enquanto toda coluna
  // nascia com o mesmo teto de 420.
  const inicial = await larguraDe(page, 'nome');
  const alca = page.locator('[data-alca="nome"]');

  const caixa = (await alca.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.down();
  await page.mouse.move(caixa.x + 150, caixa.y + caixa.height / 2);
  await page.mouse.move(caixa.x + 300, caixa.y + caixa.height / 2);
  await page.mouse.up();
  expect(await larguraDe(page, 'nome')).toBeGreaterThan(inicial + 200);

  await alca.dblclick();
  expect(await larguraDe(page, 'nome')).toBe(inicial);
});

test('o valor longo deixa de ser cortado quando a coluna é alargada', async ({ page }) => {
  await abrirTabela(page);
  await page.locator('[data-sql-da-tabela]').fill(`select '${'A'.repeat(120)}' as longo`);
  await page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' }).click();
  // Esperar a COLUNA NOVA, e não a grade: a grade da tabela já está na tela, e
  // `toBeVisible` nela passaria de imediato, medindo o resultado ANTERIOR.
  await expect(page.locator('[data-coluna="longo"]')).toBeVisible();

  const cortado = () =>
    page.evaluate(() => {
      const td = document.querySelector('[data-grade] tbody td:last-child') as HTMLElement;
      return td.scrollWidth > td.clientWidth;
    });
  expect(await cortado()).toBe(true);

  const caixa = (await page.locator('[data-alca="longo"]').boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.down();
  await page.mouse.move(caixa.x + 300, caixa.y + caixa.height / 2);
  await page.mouse.move(caixa.x + 600, caixa.y + caixa.height / 2);
  await page.mouse.up();

  expect(await cortado()).toBe(false);
});

test('cada coluna nasce do tamanho do que mostra, e não todas iguais', async ({ page }) => {
  await abrirTabela(page);
  // `id` guarda 1 e 2; `nome` guarda `joshua` e `maria`. Se as duas nascessem
  // com o mesmo teto, dez colunas caberiam onde cabem quatro — foi o que o
  // navegador mostrou depois da primeira versão desta fase.
  const id = await larguraDe(page, 'id');
  const nome = await larguraDe(page, 'nome');
  expect(id).toBeLessThan(nome);
  expect(id).toBeLessThan(120);
});

test('o tipo da coluna está na dica, e não ocupa a tela', async ({ page }) => {
  await abrirTabela(page);
  // Escrito, o tipo custava uma linha inteira do cabeçalho em toda tabela — e
  // entrava no cálculo da largura, então `id` de tipo `character varying(255)`
  // nascia larga por causa da etiqueta e não do dado (spec 097, D257).
  const th = page.locator('[data-coluna="id"]');
  await expect(th).toHaveAttribute('title', /INTEGER/i);
  await expect(th).not.toContainText('INTEGER');
});
