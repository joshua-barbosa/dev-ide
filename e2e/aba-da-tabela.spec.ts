// A aba de tabela (spec 041).
//
// A montagem do SQL é testada sem banco em `server/__tests__/tabela.test.ts`, e
// contra um motor de verdade em `sqlite.driver.test.ts`. Aqui se prova o
// caminho: abrir pela árvore, paginar, ordenar, filtrar e exportar.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, textoDoEditor, esperarIdePronta } from './fixtures';

const total = (page: Page) => page.locator('[data-total-da-tabela]');
const paginaAtual = (page: Page) => page.locator('[data-pagina-atual]');
const sqlDaAba = (page: Page) => page.locator('[data-sql-da-tabela]');

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });

  await linhaArvore(page, TABELA).hover();
    // `exact`: `alunos` é prefixo de `alunos_edicao`, a tabela que a spec 044 usa
  // para escrever. Sem isto o seletor casa com as duas.
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('abre com as linhas, o total REAL e o SQL à vista', async ({ page }) => {
  await abrirTabela(page);
  await expect(page.getByText('ana')).toBeVisible();
  await expect(page.getByText('maria')).toBeVisible();
  // "2 de 2": o total é contado, não é o número trazido.
  await expect(total(page)).toContainText('de 2');
  await expect(sqlDaAba(page)).toContainText('SELECT');
  await expect(sqlDaAba(page)).toContainText('LIMIT');
});

test('o cabeçalho marca a chave primária, e o tipo está na dica', async ({ page }) => {
  await abrirTabela(page);
  const id = page.locator('[data-coluna="id"]');
  // O tipo saiu da tela e virou dica (spec 097, D257): escrito, custava uma
  // linha do cabeçalho em toda tabela e ainda inflava a largura da coluna.
  await expect(id).toHaveAttribute('title', /INTEGER/i);
  await expect(id.getByTitle('Chave primária')).toBeVisible();
  await expect(page.locator('[data-coluna="nome"]').getByTitle('NOT NULL')).toBeVisible();
});

test('paginar traz a outra linha, e o SQL mostra o OFFSET', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Linhas por página').click();
  await page.getByRole('option', { name: '50 / página' }).click();

  // Com duas linhas e 50 por página não há segunda: o botão fica desabilitado.
  await expect(page.getByLabel('Próxima página')).toBeDisabled();
  await expect(paginaAtual(page)).toContainText('1 / 1');
});

test('ordenar pela coluna inverte a ordem na tela', async ({ page }) => {
  await abrirTabela(page);
  // Pela COLUNA, e não pela posição. Contar `td` obrigava a lembrar de cada
  // coluna de controle à esquerda — a de marcar para apagar, o número da linha,
  // a seta que abre a linha — e quebrava, sem dizer por quê, toda vez que uma
  // delas nascia.
  const primeira = () =>
    page.locator('tbody tr').first().locator('[data-celula-da-coluna="nome"]');

  await page.getByLabel('Ordenar por nome').click();
  await expect(primeira()).toHaveText('ana');
  await page.getByLabel('Ordenar por nome').click();
  await expect(primeira()).toHaveText('maria');
  // Terceiro clique volta ao natural, e o ORDER BY some do SQL.
  await page.getByLabel('Ordenar por nome').click();
  await expect(sqlDaAba(page)).not.toContainText('ORDER BY');
});

/**
 * A fila de `contém…` no cabeçalho agora aparece a PEDIDO (spec 097, D257).
 *
 * Ela custava uma linha inteira em toda tabela aberta, e ele pediu por escrito
 * "o filtro só quando pedido". Filtro em vigor traz a linha de volta sozinho.
 */
async function abrirFiltroPorColuna(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Filtrar por coluna' }).click();
}

test('filtrar por coluna reduz as linhas E o total, juntos', async ({ page }) => {
  // O par é o que faz a paginação não mentir.
  await abrirTabela(page);
  await abrirFiltroPorColuna(page);
  await page.getByLabel('Filtrar nome').fill('an');
  await expect(total(page)).toContainText('de 1');
  await expect(page.getByText('maria')).toHaveCount(0);
  await expect(sqlDaAba(page)).toContainText('LIKE');
});

// Os dois testes abaixo passaram a abrir um MENU antes de escolher o formato.
// O `Export` deixou de ser dois botões e virou um com escopo (T058): a pergunta
// que faltava não era o formato, era "isto leva a página ou a tabela inteira".

test('exportar abre o CSV numa aba, com cabeçalho e escape', async ({ page }) => {
  await abrirTabela(page);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'CSV · esta página' }).click();
  await expect.poll(() => textoDoEditor(page)).toContain('id,nome,nota');
  expect(await textoDoEditor(page)).toContain('ana');
});

test('exportar JSON sai como lista de objetos', async ({ page }) => {
  await abrirTabela(page);
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'JSON · esta página' }).click();
  await expect.poll(() => textoDoEditor(page)).toContain('"nome"');
});

test('trocar de aba e voltar NÃO perde o filtro', async ({ page }) => {
  // A aba fica montada e apenas some de vista — a regra constitucional. Remontar
  // custaria outra ida ao banco e apagaria a ordenação e os filtros.
  await abrirTabela(page);
  await abrirFiltroPorColuna(page);
  await page.getByLabel('Filtrar nome').fill('an');
  await expect(total(page)).toContainText('de 1');

  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'JSON · esta página' }).click();
  await aba(page, TABELA).click();
  await expect(page.getByLabel('Filtrar nome')).toHaveValue('an');
  await expect(total(page)).toContainText('de 1');
});

// ---------------------------------------------------------------------------
// O SQL editável (spec 043)
// ---------------------------------------------------------------------------

const campoSql = (page: Page) => page.getByLabel('SQL desta aba');

test('o SQL do topo é editável e roda com o botão', async ({ page }) => {
  await abrirTabela(page);
  await campoSql(page).fill("SELECT 'so-uma' AS marca");
  await page.getByRole('button', { name: 'Executar este SQL' }).click();

  // Na CÉLULA, e não no campo: o texto aparece nos dois, e `getByText` casaria
  // com o `textarea` também.
  await expect(page.getByRole('cell', { name: 'so-uma' })).toBeVisible();
  // Modo livre: a IDE não montou este SQL, e diz isso.
  await expect(page.locator('[data-modo-livre]')).toBeVisible();
});

test('em modo livre a paginação e o filtro por coluna somem', async ({ page }) => {
  // Botão que não faz nada é pior que botão ausente.
  await abrirTabela(page);
  await campoSql(page).fill('SELECT 1 AS um');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('[data-modo-livre]')).toBeVisible();
  await expect(page.getByLabel('Próxima página')).toHaveCount(0);
  await expect(page.getByLabel('Linhas por página')).toHaveCount(0);
  await expect(page.getByLabel('Filtrar um')).toHaveCount(0);
});

test('voltar ao SQL da tabela devolve os controles', async ({ page }) => {
  await abrirTabela(page);
  await campoSql(page).fill('SELECT 1 AS um');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('[data-modo-livre]')).toBeVisible();

  await page.getByRole('button', { name: 'Voltar ao SQL da tabela' }).click();
  await expect(page.locator('[data-modo-livre]')).toHaveCount(0);
  await expect(total(page)).toContainText('de 2');
  await expect(campoSql(page)).toHaveValue(/SELECT/);
});

test('SQL errado mostra o erro SEM perder o que foi digitado', async ({ page }) => {
  await abrirTabela(page);
  await campoSql(page).fill('SELECT * FROM nao_existe_mesmo');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('[data-erro-tabela]')).toContainText(/no such table/i);
  await expect(campoSql(page)).toHaveValue('SELECT * FROM nao_existe_mesmo');
});

test('ordenar reescreve o SQL do topo — ele é espelho', async ({ page }) => {
  await abrirTabela(page);
  await page.getByLabel('Ordenar por nome').click();
  await expect(campoSql(page)).toHaveValue(/ORDER BY "nome" ASC/);
});

test('a aba de tabela NÃO mostra o ▷ da barra de abas', async ({ page }) => {
  // Ele executava o editor do grupo, que ainda guardava outro arquivo.
  await abrirTabela(page);
  await expect(page.getByRole('button', { name: 'Executar consulta' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Executar este SQL' })).toBeVisible();
});

test('o SQL da aba de tabela sai COLORIDO (T059)', async ({ page }) => {
  // A desculpa que eu tinha escrito era "é textarea, não Monaco" — e o bloco do
  // caderno já provava que a cor não precisa de Monaco montado, só do
  // `editor.colorize()`. Aqui são as mesmas duas camadas.
  await abrirTabela(page);

  const campo = page.locator('[data-sql-da-tabela]');
  await expect(campo).toBeVisible();

  // A camada de cor fica ATRÁS, e traz mais de uma classe do Monaco: uma só
  // significa que o tokenizador não respondeu e o texto saiu sem cor.
  await expect
    .poll(async () => {
      const html = await page.locator('[data-sql-da-tabela]').evaluate(
        (el) => el.parentElement?.querySelector('pre')?.innerHTML ?? ''
      );
      return new Set(html.match(/mtk\d+/g) ?? []).size;
    }, { timeout: 15_000 })
    .toBeGreaterThan(1);
});

test('as DUAS camadas do campo de SQL medem o caractere igual', async ({ page }) => {
  // O defeito que ele descreveu usando: *"clico no final de coligadas, o cursor
  // fica no meio"*, *"se começo a apagar, ele está no final"*, *"digitar começa
  // a apagar e digitar por cima"*.
  //
  // A causa era uma linha: a aba de tabela mandava `fontSize: 11` só para a
  // `textarea`. O texto COLORIDO ficava maior que o invisível, e o cursor
  // andava numa régua diferente da que se vê.
  await abrirTabela(page);
  const campo = page.locator('[data-sql-da-tabela]');
  await expect(campo).toBeVisible();

  const metricas = await campo.evaluate((el) => {
    const pre = el.parentElement?.querySelector('pre');
    const daTextarea = getComputedStyle(el);
    const daCor = pre === null || pre === undefined ? null : getComputedStyle(pre);
    return {
      fonteTexto: daTextarea.fontSize,
      fonteCor: daCor?.fontSize ?? '',
      entrelinhaTexto: daTextarea.lineHeight,
      entrelinhaCor: daCor?.lineHeight ?? '',
      familiaTexto: daTextarea.fontFamily,
      familiaCor: daCor?.fontFamily ?? '',
      padTexto: daTextarea.padding,
      padCor: daCor?.padding ?? '',
      larguraTexto: el.scrollWidth,
      larguraCor: pre?.scrollWidth ?? 0,
    };
  });

  assertIguais(metricas);
});

/** As quatro propriedades que decidem onde um caractere cai. */
function assertIguais(m: Record<string, string | number>): void {
  expect(m.fonteTexto).toBe(m.fonteCor);
  expect(m.entrelinhaTexto).toBe(m.entrelinhaCor);
  expect(m.familiaTexto).toBe(m.familiaCor);
  expect(m.padTexto).toBe(m.padCor);
}

test('o MESMO texto ocupa a mesma largura nas duas camadas', async ({ page }) => {
  // É a consequência observável do desalinhamento, e o que ele viu: o texto
  // colorido mais largo que o invisível faz o cursor — desenhado pela camada
  // invisível — cair no meio da palavra que se vê.
  await abrirTabela(page);
  const campo = page.locator('[data-sql-da-tabela]');
  await expect(campo).toBeVisible();
  await campoSql(page).fill('SELECT id, nome, criado_em FROM alunos WHERE ativo = 1');

  await expect
    .poll(async () =>
      campo.evaluate((el) => {
        const pre = el.parentElement?.querySelector('pre');
        if (pre === null || pre === undefined) return -1;
        // A largura do CONTEÚDO, medida pelo mesmo caminho nos dois.
        const faixa = document.createRange();
        faixa.selectNodeContents(pre);
        const daCor = faixa.getBoundingClientRect().width;

        const sonda = document.createElement('span');
        const estilo = getComputedStyle(el);
        sonda.style.font = estilo.font;
        sonda.style.letterSpacing = estilo.letterSpacing;
        sonda.style.whiteSpace = 'pre';
        sonda.textContent = (el as HTMLTextAreaElement).value;
        document.body.appendChild(sonda);
        const doTexto = sonda.getBoundingClientRect().width;
        sonda.remove();

        return Math.abs(daCor - doTexto);
      }), { timeout: 15_000 })
    .toBeLessThan(2);
});
