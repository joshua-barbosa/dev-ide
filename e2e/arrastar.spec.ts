// Arrastar para dividir (spec 025).
//
// O pedido do usuário, com as palavras dele: *"você consegue arrastar um arquivo
// da árvore para área ali e ele mostra como que vai ficar a divisão, pra
// esquerda, pra direita, pra cima, pra baixo, fazer mais de uma divisão"*.
//
// O cálculo da zona e as operações sobre a árvore de arranjo são testados sem
// navegador (`shared/__tests__/arrastar.test.ts` e `layout-editor.test.ts`).
// Aqui se prova o caminho: arrastar de verdade, ver o indicador, soltar, e o
// conteúdo aparecer do lado certo.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { linhaArvore, menu, esperarIdePronta } from './fixtures';

const grupo = (page: Page, n: number) => page.locator(`[data-grupo-editor="${n}"]`);
const grupos = (page: Page) => page.locator('[data-grupo-editor]');
const indicador = (page: Page) => page.locator('[data-zona-de-soltura]');

/** Texto do editor de um grupo, com o espaço inquebrável do Monaco normalizado. */
async function textoDoGrupo(page: Page, n: number): Promise<string> {
  const bruto = await grupo(page, n).locator('.view-lines').first().innerText();
  return bruto.replace(/\u00a0/g, ' ');
}

/**
 * Arrasta com o mouse, parando sobre o alvo antes de soltar.
 *
 * `dragTo` num passo só não dá tempo de o indicador aparecer, e é justamente ele
 * que se quer verificar. Os passos intermediários também imitam a mão: ninguém
 * teleporta o cursor até a borda.
 */
async function arrastarAte(
  page: Page,
  origem: Locator,
  alvo: Locator,
  posicao: { x: number; y: number }
): Promise<void> {
  await origem.hover();
  await page.mouse.down();

  const r = await alvo.boundingBox();
  if (r === null) throw new Error('o alvo do arraste não está na tela');
  const x = r.x + posicao.x;
  const y = r.y + posicao.y;

  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x, y, { steps: 2 });
}

/** Fração da largura/altura do alvo, para mirar em borda ou centro. */
async function ponto(alvo: Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const r = await alvo.boundingBox();
  if (r === null) throw new Error('alvo sem medida');
  return { x: r.width * fx, y: r.height * fy };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a IDE começa com um grupo só', async ({ page }) => {
  await expect(grupos(page)).toHaveCount(1);
  await expect(indicador(page)).toHaveCount(0);
});

test('arrastar da árvore para a BORDA DIREITA divide em dois', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();

  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.95, 0.5));

  // A metade da feature que o usuário descreveu: ver onde vai cair.
  await expect(indicador(page)).toHaveAttribute('data-zona-de-soltura', 'direita');
  await page.mouse.up();

  await expect(grupos(page)).toHaveCount(2);
  await expect(page.locator('[data-divisao="horizontal"]')).toHaveCount(1);
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();
  await expect(grupo(page, 1).locator('[data-tab="consulta.sql"]')).toBeVisible();
});

test('arrastar para a BORDA DE BAIXO empilha', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.5, 0.95));

  await expect(indicador(page)).toHaveAttribute('data-zona-de-soltura', 'baixo');
  await page.mouse.up();

  await expect(page.locator('[data-divisao="vertical"]')).toHaveCount(1);
  await expect(grupos(page)).toHaveCount(2);
});

test('arrastar para a BORDA ESQUERDA põe o novo ANTES', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.03, 0.5));

  await expect(indicador(page)).toHaveAttribute('data-zona-de-soltura', 'esquerda');
  await page.mouse.up();

  // O grupo novo entra à esquerda, então é ele quem aparece primeiro na tela.
  const primeiro = grupos(page).first();
  await expect(primeiro.locator('[data-tab="consulta.sql"]')).toBeVisible();
});

test('soltar no CENTRO abre no próprio grupo, sem dividir', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.5, 0.5));

  await expect(indicador(page)).toHaveAttribute('data-zona-de-soltura', 'centro');
  await page.mouse.up();

  await expect(grupos(page)).toHaveCount(1);
  await expect(grupo(page, 0).locator('[data-tab="consulta.sql"]')).toBeVisible();
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toBeVisible();
});

test('MAIS DE UMA DIVISÃO, com orientações misturadas', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();

  const primeiro = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), primeiro, await ponto(primeiro, 0.95, 0.5));
  await page.mouse.up();
  await expect(grupos(page)).toHaveCount(2);

  // Um TERCEIRO conteúdo, e não um arquivo já aberto: arrastar o que já está
  // numa aba MOVE em vez de duplicar, e o grupo de origem esvaziaria e sumiria.
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  const novaAba = page.locator('[data-tab="untitled-1"]');
  await expect(novaAba).toBeVisible();

  // Divide o lado direito para baixo: aninha.
  const segundo = grupo(page, 1);
  await arrastarAte(page, novaAba, segundo, await ponto(segundo, 0.5, 0.95));
  await page.mouse.up();

  await expect(grupos(page)).toHaveCount(3);
  await expect(page.locator('[data-divisao="horizontal"]')).toHaveCount(1);
  await expect(page.locator('[data-divisao="vertical"]')).toHaveCount(1);
});

test('CADA LADO FICA COM O PRÓPRIO CONTEÚDO', async ({ page }) => {
  // Regressão do defeito que apareceu ao construir isto: mudar o arranjo muda a
  // forma da árvore, o React remonta os editores que trocaram de lugar nela, e
  // os grupos nasciam EM BRANCO. Descarregar todos antes de mexer no arranjo, e
  // recarregar quando um editor novo se registra, é o que conserta.
  await linhaArvore(page, 'utils.ts').click();
  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.95, 0.5));
  await page.mouse.up();

  await expect.poll(() => textoDoGrupo(page, 0)).toMatch(/VERSAO/);
  await expect.poll(() => textoDoGrupo(page, 1)).toMatch(/SELECT id, nome FROM alunos/);
});

test('arrastar uma ABA para a borda leva ela para o lado novo', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  await linhaArvore(page, 'consulta.sql').click();
  await expect(grupo(page, 0).locator('[data-tab]')).toHaveCount(2);

  const alvo = grupo(page, 0);
  await arrastarAte(
    page,
    grupo(page, 0).locator('[data-tab="utils.ts"]'),
    alvo,
    await ponto(alvo, 0.95, 0.5)
  );
  await expect(indicador(page)).toHaveAttribute('data-zona-de-soltura', 'direita');
  await page.mouse.up();

  await expect(grupos(page)).toHaveCount(2);
  await expect(grupo(page, 1).locator('[data-tab="utils.ts"]')).toBeVisible();
  await expect(grupo(page, 0).locator('[data-tab="utils.ts"]')).toHaveCount(0);
});

test('arrastar da árvore um arquivo JÁ ABERTO move, e não duplica', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  await linhaArvore(page, 'consulta.sql').click();

  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'utils.ts'), alvo, await ponto(alvo, 0.95, 0.5));
  await page.mouse.up();

  await expect(page.locator('[data-tab="utils.ts"]')).toHaveCount(1);
  await expect(grupo(page, 1).locator('[data-tab="utils.ts"]')).toBeVisible();
});

test('fechar a última aba de um lado desfaz a divisão', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.95, 0.5));
  await page.mouse.up();
  await expect(grupos(page)).toHaveCount(2);

  await grupo(page, 1).locator('[data-tab="consulta.sql"]').locator('button').click();

  // Metade de tela em branco é estado que ninguém pediu.
  await expect(grupos(page)).toHaveCount(1);
  await expect(page.locator('[data-divisao]')).toHaveCount(0);
});

test('o indicador some ao sair do grupo sem soltar', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  const alvo = grupo(page, 0);
  await arrastarAte(page, linhaArvore(page, 'consulta.sql'), alvo, await ponto(alvo, 0.95, 0.5));
  await expect(indicador(page)).toBeVisible();

  // Volta para a lateral: o arraste continua, mas não sobre um grupo.
  await linhaArvore(page, 'utils.ts').hover();
  await expect(indicador(page)).toHaveCount(0);
  await page.mouse.up();
});

test('Split Editor pelo menu continua funcionando', async ({ page }) => {
  await linhaArvore(page, 'utils.ts').click();
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Split Editor' }).click();

  await expect(grupos(page)).toHaveCount(1);
  // Com uma aba só, dividir move a única que existe: o grupo de origem fica
  // vazio e some, e sobra um. Com duas abas, sobram dois lados.
  await linhaArvore(page, 'consulta.sql').click();
  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Split Editor' }).click();
  await expect(grupos(page)).toHaveCount(2);
});
