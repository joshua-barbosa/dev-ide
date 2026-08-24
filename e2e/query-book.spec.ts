// O Query Book (spec 048).
//
// O formato do arquivo é testado sem navegador em `shared/__tests__/caderno.test.ts`.
// Aqui se prova a superfície: blocos, markdown renderizado, rodar um e rodar
// todos, e — o que mais importa num caderno — que `Ctrl+S` grava.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import {
  aba, destrancarCofre, entradaRapida, esperarIdePronta, expandir, linhaArvore, painelLateral,
} from './fixtures';

const bloco = (page: Page, i: number) => page.locator('[data-bloco]').nth(i);

/**
 * A barra do topo do caderno.
 *
 * Desde a spec 050 `Add Code` e `Add Markdown` existem também em cada FRESTA
 * entre blocos, então dizer só o nome do botão virou ambíguo — e é ambiguidade
 * de verdade, não do teste: a tela tem mesmo vários. Quem quer o do topo diz.
 */
const barra = (page: Page) => page.locator('[data-barra-do-caderno]');

async function novoCaderno(page: Page, nome: string): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');

  // Pelo `+`: ele PERGUNTA o tipo antes do nome (spec 049).
  await linhaArvore(page, 'Query').hover();
  await page.getByRole('button', { name: /Nova query/ }).click();
  await page.getByRole('option', { name: /Query Book/ }).click();
  await entradaRapida(page).fill(nome);
  await page.keyboard.press('Enter');
  await expect(aba(page, `${nome}.sqlbook`)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('um .sqlbook abre como CADERNO, e não como texto', async ({ page }) => {
  await novoCaderno(page, 'novo');
  await expect(page.getByText('Caderno vazio.')).toBeVisible();
  await expect(barra(page).getByRole('button', { name: 'Add Code' })).toBeVisible();
});

test('acrescentar blocos e contar', async ({ page }) => {
  await novoCaderno(page, 'contagem');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await barra(page).getByRole('button', { name: 'Add Markdown' }).click();

  await expect(page.locator('[data-bloco]')).toHaveCount(2);
  await expect(bloco(page, 0)).toHaveAttribute('data-tipo', 'sql');
  await expect(bloco(page, 1)).toHaveAttribute('data-tipo', 'markdown');
});

test('o bloco de markdown alterna entre editar e renderizado', async ({ page }) => {
  await novoCaderno(page, 'texto');
  await barra(page).getByRole('button', { name: 'Add Markdown' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('# Chamado 64158');

  await page.getByRole('button', { name: 'Ver renderizado' }).click();
  await expect(page.locator('[data-markdown-preview] h1')).toHaveText('Chamado 64158');
});

test('rodar um bloco de SQL abre o resultado', async ({ page }) => {
  await novoCaderno(page, 'rodar');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill("SELECT 'do-caderno' AS marca");
  await page.getByRole('button', { name: '▷ Run' }).click();

  await expect(page.getByRole('cell', { name: 'do-caderno' })).toBeVisible();
});

test('Run All roda os blocos de SQL e PULA o markdown', async ({ page }) => {
  await novoCaderno(page, 'tudo');
  await barra(page).getByRole('button', { name: 'Add Markdown' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('## explicação');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 2/ }).fill("SELECT 'um' AS q");
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 3/ }).fill("SELECT 'dois' AS q");

  await page.getByRole('button', { name: 'Run All' }).click();
  // `+Tab` por bloco: os dois resultados convivem, e o markdown não virou aba.
  await expect(aba(page, 'Resultado')).toHaveCount(2);
});

test('Run All PARA no primeiro erro', async ({ page }) => {
  // Um caderno é uma sequência: seguir depois de falhar daria resultados que
  // não querem dizer nada.
  await novoCaderno(page, 'erro');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('SELECT * FROM nao_existe_mesmo');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 2/ }).fill("SELECT 'nao-devia-rodar' AS q");

  await page.getByRole('button', { name: 'Run All' }).click();
  await expect(page.locator('[data-erro-caderno]')).toContainText('Parou no bloco');
  await expect(page.getByRole('cell', { name: 'nao-devia-rodar' })).toHaveCount(0);
});

test('Ctrl+S grava o caderno, e ele volta igual depois do F5', async ({ page }) => {
  await novoCaderno(page, 'salvo');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('SELECT 42');
  await expect(aba(page, 'salvo.sqlbook')).toContainText('●');

  await page.keyboard.press('Control+s');
  await expect(aba(page, 'salvo.sqlbook')).not.toContainText('●');

  await page.reload();
  await esperarIdePronta(page);
  await expect(page.getByRole('textbox', { name: /Bloco 1/ })).toHaveValue('SELECT 42');
});


// ---------------------------------------------------------------------------
// Escolher o que criar (spec 049)
// ---------------------------------------------------------------------------

test('o + PERGUNTA o tipo antes do nome', async ({ page }) => {
  // O botão sozinho não dizia o que acrescentava: quem não soubesse digitar
  // `.sqlbook` nunca criaria um caderno.
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');

  await linhaArvore(page, 'Query').hover();
  await page.getByRole('button', { name: /Nova query/ }).click();
  await expect(page.getByRole('option', { name: /Query SQL/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Query Book/ })).toBeVisible();
});

test('escolher Query SQL cria .sql; escolher Query Book cria .sqlbook', async ({ page }) => {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');

  // Pelo menu do botão direito, que é onde as duas aparecem por extenso.
  await linhaArvore(page, 'Query').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Nova query SQL…' }).click();
  await entradaRapida(page).fill('so-sql');
  await page.keyboard.press('Enter');
  await expect(aba(page, 'so-sql.sql')).toBeVisible();

  await painelLateral(page, 'Database').click();
  await linhaArvore(page, 'Query').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Novo Query Book…' }).click();
  await entradaRapida(page).fill('so-caderno');
  await page.keyboard.press('Enter');
  await expect(aba(page, 'so-caderno.sqlbook')).toBeVisible();
  // E abriu como CADERNO, não como texto.
  await expect(barra(page).getByRole('button', { name: 'Add Code' })).toBeVisible();
});


// ---------------------------------------------------------------------------
// A superfície revista (spec 050)
// ---------------------------------------------------------------------------

/** Prepara um caderno com dois blocos de SQL, para os testes de ordem. */
async function doisBlocos(page: Page, nome: string): Promise<void> {
  await novoCaderno(page, nome);
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill('SELECT 1 AS primeiro');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 2/ }).fill('SELECT 2 AS segundo');
}

test('o bloco de SQL aparece COLORIDO, com as cores do editor', async ({ page }) => {
  await novoCaderno(page, 'cor');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.getByRole('textbox', { name: /Bloco 1/ }).fill("SELECT 'x' FROM alunos");

  const camada = page.locator('[data-colorido]').first();
  // O texto da camada de baixo é o mesmo da de cima — é o que garante que o
  // cursor não vai mentir (AC-4). `toHaveText` normaliza o espaço, e o Monaco
  // escreve espaço não separável: é a mesma ressalva de `fixtures.ts`.
  await expect(camada).toHaveText("SELECT 'x' FROM alunos");

  // E ele foi TOKENIZADO. A cor NÃO está no `style` do elemento: o colorizador
  // emite classes (`mtk7`, `mtk20`) e o tema injeta as regras na página, então
  // quem sabe a cor é o estilo COMPUTADO. Verificar `style.color` daria uma
  // lista vazia e um teste que passa sem provar nada.
  const cores = await camada.locator('span[class^="mtk"]').evaluateAll((ns) =>
    [...new Set(ns.map((n) => getComputedStyle(n).color))]
  );
  expect(cores.length).toBeGreaterThan(1);
});

test('as duas camadas do bloco ocupam EXATAMENTE o mesmo espaço', async ({ page }) => {
  // O risco da técnica da spec 050 (D15) é um só: se a camada colorida e a de
  // edição divergirem, o cursor passa a cair num lugar e a letra a aparecer em
  // outro. É invisível numa tela e catastrófico no uso — então a igualdade
  // vira medida, e não impressão.
  await novoCaderno(page, 'alinhado');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page
    .getByRole('textbox', { name: /Bloco 1/ })
    .fill("SELECT nome, 'x' AS marca\n  FROM alunos\n WHERE id > 10;");

  const medida = await page.locator('[data-bloco]').first().evaluate((no) => {
    const ta = no.querySelector('textarea') as HTMLTextAreaElement;
    const pre = no.querySelector('pre') as HTMLPreElement;
    const a = ta.getBoundingClientRect();
    const b = pre.getBoundingClientRect();
    const ca = getComputedStyle(ta);
    const cb = getComputedStyle(pre);
    return {
      fonte: [ca.font, ca.lineHeight, ca.letterSpacing, ca.padding, ca.whiteSpace, ca.overflowWrap, ca.tabSize].join('|'),
      fontePre: [cb.font, cb.lineHeight, cb.letterSpacing, cb.padding, cb.whiteSpace, cb.overflowWrap, cb.tabSize].join('|'),
      desvio: [a.left - b.left, a.top - b.top, a.width - b.width, a.height - b.height],
    };
  });

  expect(medida.fontePre).toBe(medida.fonte);
  for (const d of medida.desvio) expect(Math.abs(d)).toBeLessThan(0.5);
});

test('a fresta acrescenta bloco NAQUELA posição, e não no fim', async ({ page }) => {
  await doisBlocos(page, 'fresta');

  // A fresta 0 é a de antes do primeiro bloco.
  const fresta = page.locator('[data-fresta="0"]');
  await fresta.hover();
  await fresta.getByRole('button', { name: 'Add Markdown' }).click();

  await expect(page.locator('[data-bloco]')).toHaveCount(3);
  await expect(bloco(page, 0)).toHaveAttribute('data-tipo', 'markdown');
  await expect(bloco(page, 1)).toHaveAttribute('data-tipo', 'sql');
});

test('arrastar o bloco pela alça troca a ordem', async ({ page }) => {
  await doisBlocos(page, 'arrastar');
  await expect(page.getByRole('textbox', { name: /Bloco 1/ })).toHaveValue('SELECT 1 AS primeiro');

  // A alça só existe sob o mouse: é o próprio hover que a revela.
  await bloco(page, 0).hover();
  await bloco(page, 0).locator('[data-pegar]').dragTo(page.locator('[data-fresta="2"]'));

  // O primeiro virou o segundo — e o conteúdo foi junto.
  await expect(page.getByRole('textbox', { name: /Bloco 1/ })).toHaveValue('SELECT 2 AS segundo');
  await expect(page.getByRole('textbox', { name: /Bloco 2/ })).toHaveValue('SELECT 1 AS primeiro');
});

test('as ações do bloco só aparecem sob o mouse — mas as de RODAR ficam', async ({ page }) => {
  await doisBlocos(page, 'hover');

  // O bloco 2 acabou de receber texto e está COM O FOCO — e foco dentro do
  // bloco também revela a barra, de propósito (AC-14). Quem prova o esconder é
  // o bloco 1: sem foco, e com o mouse longe.
  const admin = bloco(page, 0).locator('.administrar');
  await barra(page).hover();
  await expect(admin).toHaveCSS('opacity', '0');
  // O que se USA não se esconde (AC-15).
  await expect(bloco(page, 0).getByRole('button', { name: '▷ Run' })).toBeVisible();

  await bloco(page, 0).hover();
  await expect(admin).toHaveCSS('opacity', '1');
});

test('arrastar e soltar na PRÓPRIA posição não suja o arquivo', async ({ page }) => {
  await doisBlocos(page, 'inocuo');
  await page.keyboard.press('Control+s');
  await expect(aba(page, 'inocuo.sqlbook')).not.toContainText('●');

  await bloco(page, 0).hover();
  // A fresta 1 é a que fica logo depois do bloco 0: soltar ali é não sair do
  // lugar.
  await bloco(page, 0).locator('[data-pegar]').dragTo(page.locator('[data-fresta="1"]'));

  await expect(aba(page, 'inocuo.sqlbook')).not.toContainText('●');
});


// ---------------------------------------------------------------------------
// Linguagem por bloco, e contra quem o caderno roda (spec 051)
// ---------------------------------------------------------------------------

test('o bloco tem seletor de LINGUAGEM, com todas as do editor', async ({ page }) => {
  await novoCaderno(page, 'linguagem');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();

  const seletor = bloco(page, 0).getByRole('button', { name: /Linguagem do bloco/ });
  await expect(seletor).toHaveText(/SQL/);
  await seletor.click();

  // A MESMA lista do seletor do rodapé — é o "Select Language Mode" dele.
  await expect(page.getByRole('option', { name: 'JavaScript' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Markdown' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'PHP' })).toBeVisible();
});

test('trocar a linguagem troca o que o bloco OFERECE', async ({ page }) => {
  await novoCaderno(page, 'oferece');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  // SQL: os três.
  await expect(bloco(page, 0).getByRole('button', { name: '＋Tab' })).toBeVisible();

  await bloco(page, 0).getByRole('button', { name: /Linguagem do bloco/ }).click();
  await page.getByRole('option', { name: 'JavaScript' }).click();

  // Runner: só `Run` — `＋Tab` e `JSON` são do banco, não fazem sentido aqui.
  await expect(bloco(page, 0)).toHaveAttribute('data-tipo', 'javascript');
  await expect(bloco(page, 0).getByRole('button', { name: '▷ Run' })).toBeVisible();
  await expect(bloco(page, 0).getByRole('button', { name: '＋Tab' })).toHaveCount(0);

  await bloco(page, 0).getByRole('button', { name: /Linguagem do bloco/ }).click();
  await page.getByRole('option', { name: 'YAML' }).click();

  // Sem destino: nenhum `Run`. Um botão que não faz nada é promessa quebrada.
  await expect(bloco(page, 0).getByRole('button', { name: '▷ Run' })).toHaveCount(0);
});

test('bloco de JavaScript roda no runner, e a saída cai no Output', async ({ page }) => {
  await novoCaderno(page, 'runner');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await bloco(page, 0).getByRole('button', { name: /Linguagem do bloco/ }).click();
  await page.getByRole('option', { name: 'JavaScript' }).click();
  await page
    .getByRole('textbox', { name: /Bloco 1/ })
    .fill("console.log('veio-do-bloco')");

  await bloco(page, 0).getByRole('button', { name: '▷ Run' }).click();
  // O painel vem À FRENTE. Sem isto o bloco rodava, a saída era escrita e a
  // tela não mudava nada — que é como isto apareceu, no navegador.
  await expect(page.locator('[data-output]')).toBeVisible();
  // E no `Output`, não em qualquer lugar da página: o próprio bloco mostra esse
  // texto — é o código que o usuário escreveu.
  await expect(page.locator('[data-output]')).toContainText('veio-do-bloco', {
    timeout: 30_000,
  });
});

test('a barra do caderno diz contra quem ele roda', async ({ page }) => {
  await novoCaderno(page, 'kernel');
  // O caderno nasceu na pasta `Query` de um database, então o CAMINHO já
  // amarra: ele não precisa perguntar nada (spec 038).
  // `main` e não `escola.db`: o nó da árvore mostra o ARQUIVO, e o database de
  // um SQLite se chama `main`. É o mesmo nome que o rodapé mostra para um `.sql`
  // daquela pasta.
  await expect(barra(page).locator('[data-vinculo-do-caderno]')).toHaveAttribute(
    'data-vinculo-do-caderno',
    'main'
  );
});

test('um .sqlbook da VERSÃO 1 abre, e é gravado de volta na 2', async ({ page }) => {
  // Não é hipótese: os cadernos que ele criou nos últimos dias estão em disco
  // com `tipo`, e não `linguagem`.
  const raiz = await page.evaluate(async () => {
    const r = await fetch('/api/projects').then((x) => x.json());
    return (r.data as { dir: string }[])[0]?.dir ?? '';
  });
  const caminho = `${raiz}/v1.sqlbook`;
  await page.evaluate(
    async ([caminho, conteudo]) => {
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: caminho, content: conteudo }),
      });
    },
    [
      caminho,
      JSON.stringify({
        versao: 1,
        celulas: [
          { tipo: 'markdown', conteudo: '# vindo da versao 1' },
          { tipo: 'sql', conteudo: 'SELECT 1' },
        ],
      }),
    ]
  );

  await page.reload();
  await esperarIdePronta(page);
  await linhaArvore(page, 'v1.sqlbook').click();
  await expect(aba(page, 'v1.sqlbook')).toBeVisible();

  // Os dois blocos vieram, com o tipo certo.
  await expect(page.locator('[data-bloco]')).toHaveCount(2);
  await expect(bloco(page, 0)).toHaveAttribute('data-tipo', 'markdown');
  await expect(bloco(page, 1)).toHaveAttribute('data-tipo', 'sql');

  // E ao salvar, o arquivo passa a ser versão 2.
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.keyboard.press('Control+s');
  await expect(aba(page, 'v1.sqlbook')).not.toContainText('\u25cf');

  const gravado = await page.evaluate(async (caminho) => {
    const r = await fetch(`/api/file?path=${encodeURIComponent(caminho)}`).then((x) => x.json());
    return (r.data as { content: string }).content;
  }, caminho);
  const dados = JSON.parse(gravado) as { versao: number; celulas: { linguagem: string }[] };
  expect(dados.versao).toBe(2);
  expect(dados.celulas.map((c) => c.linguagem)).toEqual(['markdown', 'sql', 'sql']);
});
