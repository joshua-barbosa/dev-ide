// O Query Book (spec 048).
//
// O formato do arquivo é testado sem navegador em `shared/__tests__/caderno.test.ts`.
// Aqui se prova a superfície: blocos, markdown renderizado, rodar um e rodar
// todos, e — o que mais importa num caderno — que `Ctrl+S` grava.
import { expect, test, type Page } from '@playwright/test';
import { VERSAO_DO_CADERNO } from '../src/shared/sql/caderno';
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

/**
 * Escreve num bloco.
 *
 * Desde o T073 o bloco troca a camada de texto pelo MONACO ao ganhar foco — é o
 * desenho que ele pediu: "Monaco só no bloco em foco". Escrever passou a ser
 * clicar e digitar, e não `fill` numa `textarea` que deixa de existir no clique.
 */
async function escreverNoBloco(page: Page, indice: number, texto: string): Promise<void> {
  await bloco(page, indice).click();
  // O markdown em edição continua sendo `textarea` pura: o T073 trocou só o
  // bloco de CÓDIGO, porque é lá que multi-cursor faz falta.
  if ((await bloco(page, indice).getAttribute('data-tipo')) !== 'markdown') {
    // ESPERAR a troca: o Monaco entra num efeito do React, depois que o clique
    // já voltou. Digitar antes disso manda as teclas para uma `textarea` que já
    // está sendo desmontada, e o texto chega pela metade.
    await bloco(page, indice).locator('[data-editor-do-bloco]').waitFor();
  }
  await page.keyboard.press('Control+a');
  // Linha a linha, com `Enter` de verdade: o `\n` de `type()` não quebra linha
  // no Monaco — ele o engole, e o texto chega todo numa linha só.
  const linhas = texto.split('\n');
  for (const [i, linha] of linhas.entries()) {
    if (i > 0) {
      // `Escape` ANTES do `Enter`: com o autocomplete do T053 no ar, o `Enter`
      // ACEITA a sugestão em vez de quebrar a linha — que é o comportamento
      // certo do Monaco, e uma armadilha para quem escreve teste.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
    }
    if (linha !== '') await page.keyboard.type(linha);
  }
  await page.keyboard.press('Escape');
}

/** Tira o foco do bloco, para a camada de cor voltar. */
async function sairDoBloco(page: Page): Promise<void> {
  await barra(page).click({ position: { x: 5, y: 5 } });
}

async function novoCaderno(page: Page, nome: string): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
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
  await escreverNoBloco(page, 0, '# Chamado 64158');

  await page.getByRole('button', { name: 'Ver renderizado' }).click();
  await expect(page.locator('[data-markdown-preview] h1')).toHaveText('Chamado 64158');
});

test('rodar um bloco de SQL abre o resultado', async ({ page }) => {
  await novoCaderno(page, 'rodar');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, "SELECT 'do-caderno' AS marca");
  await page.getByRole('button', { name: '▷ Run' }).click();

  await expect(page.getByRole('cell', { name: 'do-caderno' })).toBeVisible();
});

test('Run All roda os blocos de SQL e PULA o markdown', async ({ page }) => {
  await novoCaderno(page, 'tudo');
  await barra(page).getByRole('button', { name: 'Add Markdown' }).click();
  await escreverNoBloco(page, 0, '## explicação');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 1, "SELECT 'um' AS q");
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 2, "SELECT 'dois' AS q");

  await page.getByRole('button', { name: 'Run All' }).click();
  // `+Tab` por bloco: os dois resultados convivem, e o markdown não virou aba.
  await expect(aba(page, 'Resultado')).toHaveCount(2);
});

test('Run All PARA no primeiro erro', async ({ page }) => {
  // Um caderno é uma sequência: seguir depois de falhar daria resultados que
  // não querem dizer nada.
  await novoCaderno(page, 'erro');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, 'SELECT * FROM nao_existe_mesmo');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 1, "SELECT 'nao-devia-rodar' AS q");

  await page.getByRole('button', { name: 'Run All' }).click();
  await expect(page.locator('[data-erro-caderno]')).toContainText('Parou no bloco');
  await expect(page.getByRole('cell', { name: 'nao-devia-rodar' })).toHaveCount(0);
});

test('Ctrl+S grava o caderno, e ele volta igual depois do F5', async ({ page }) => {
  await novoCaderno(page, 'salvo');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, 'SELECT 42');
  await expect(aba(page, 'salvo.sqlbook')).toContainText('●');
  // Conferir que a ÚLTIMA tecla chegou ao caderno antes de gravar. Sem isto o
  // teste corria com o `Ctrl+S`: o `●` aparece na primeira alteração, e não na
  // última.
  await sairDoBloco(page);
  await expect(page.locator('[data-colorido]').first()).toHaveText('SELECT 42');

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
  const senha = page.getByLabel('Senha mestra', { exact: true });
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
  const senha = page.getByLabel('Senha mestra', { exact: true });
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
  await escreverNoBloco(page, 0, 'SELECT 1 AS primeiro');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 1, 'SELECT 2 AS segundo');
}

test('o bloco de SQL aparece COLORIDO, com as cores do editor', async ({ page }) => {
  await novoCaderno(page, 'cor');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, "SELECT 'x' FROM alunos");
  // A camada de cor só existe com o bloco PARADO: em foco quem está ali é o
  // Monaco (T073). Sair do bloco é parte do que se está testando.
  await sairDoBloco(page);

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
  // O risco da técnica da spec 050 (D17) é um só: se a camada colorida e a de
  // edição divergirem, o cursor passa a cair num lugar e a letra a aparecer em
  // outro. É invisível numa tela e catastrófico no uso — então a igualdade
  // vira medida, e não impressão.
  await novoCaderno(page, 'alinhado');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, "SELECT nome, 'x' AS marca\n  FROM alunos\n WHERE id > 10;");
  // A camada de cor só existe com o bloco PARADO: em foco quem está ali é o
  // Monaco (T073). Sair do bloco é parte do que se está testando.
  await sairDoBloco(page);

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
  await escreverNoBloco(page, 0, "console.log('veio-do-bloco')");

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

test('um .sqlbook da VERSÃO 1 abre, e é gravado de volta na versão corrente', async ({ page }) => {
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

  // E ao salvar, o arquivo passa a ser a versão CORRENTE (3 desde o T072).
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await page.keyboard.press('Control+s');
  await expect(aba(page, 'v1.sqlbook')).not.toContainText('\u25cf');

  const gravado = await page.evaluate(async (caminho) => {
    const r = await fetch(`/api/file?path=${encodeURIComponent(caminho)}`).then((x) => x.json());
    return (r.data as { content: string }).content;
  }, caminho);
  const dados = JSON.parse(gravado) as { versao: number; celulas: { linguagem: string }[] };
  expect(dados.versao).toBe(VERSAO_DO_CADERNO);
  expect(dados.celulas.map((c) => c.linguagem)).toEqual(['markdown', 'sql', 'sql']);
});

test('salvar o resultado NO caderno, com o nome que ele dá (T072)', async ({ page }) => {
  // A nota dele na triagem: "não salvar automático, ele dar a opção de salvar
  // atrelado ao sqlbook, ao code block e com um nome que eu der".
  const nome = `guardar-${Date.now()}`;
  await novoCaderno(page, nome);
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, "SELECT 'guardado' AS qual");

  // Antes de rodar não há o que salvar: o botão nem existe.
  await expect(page.getByRole('button', { name: '⤓ Salvar resultado' })).toHaveCount(0);

  await page.getByRole('button', { name: '▷ Run' }).first().click();
  await expect(page.getByText('guardado', { exact: true })).toBeVisible();

  // O resultado abriu numa aba própria e roubou o foco: voltar ao caderno é
  // parte do fluxo, e o botão de salvar mora no BLOCO.
  await aba(page, `${nome}.sqlbook`).click();
  await page.getByRole('button', { name: '⤓ Salvar resultado' }).first().click();
  await entradaRapida(page).fill('vendas de junho');
  await page.keyboard.press('Enter');

  // Fica preso ao BLOCO, com o nome dele.
  const salvos = page.locator('[data-resultados-salvos]');
  await expect(salvos.getByRole('button', { name: /Abrir o resultado "vendas de junho"/ }))
    .toBeVisible();

  // E sobrevive ao arquivo: o caderno é gravado com o resultado dentro.
  await page.keyboard.press('Control+s');
  await page.reload();
  await esperarIdePronta(page);
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Query');
  await linhaArvore(page, `${nome}.sqlbook`).dblclick();
  await expect(
    page.locator('[data-resultados-salvos]')
      .getByRole('button', { name: /Abrir o resultado "vendas de junho"/ })
  ).toBeVisible();
});

test('o Enter do bloco quebra linha de verdade', async ({ page }) => {
  // Guarda simples e barata: se o `Enter` parar de quebrar linha dentro do
  // bloco, tudo o mais continua parecendo funcionar.
  await novoCaderno(page, `enter-${Date.now()}`);
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, 'aaa\nbbb');
  await sairDoBloco(page);

  // Conta `<br>`, e NÃO `\n`: o colorizador do Monaco emite quebra como
  // elemento, e `textContent` não traz nenhuma. Foi assim que este teste
  // acusou um defeito que não existia.
  const quebras = await page.locator('[data-colorido]').first().evaluate(
    (no) => no.querySelectorAll('br').length
  );
  // `>= 1`, e não um número exato: o colorizador fecha cada linha com um
  // `<br/>`, inclusive a última. O que este teste guarda é que HÁ quebra —
  // fixar a contagem seria testar o detalhe interno dele.
  expect(quebras).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-colorido]').first()).toContainText('aaa');
  await expect(page.locator('[data-colorido]').first()).toContainText('bbb');
});

test('o bloco em FOCO vira Monaco, e tem multi-cursor (T073)', async ({ page }) => {
  // A desculpa que eu tinha escrito na spec 050 era "o bloco é pequeno". Ele
  // respondeu com o desenho: "Monaco só no bloco em foco".
  await novoCaderno(page, `multi-${Date.now()}`);
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, 'xx xx xx');

  // `Ctrl+D` acrescenta um cursor na próxima ocorrência — o gesto que uma
  // `textarea` não tem por definição do HTML, e a razão de o Monaco entrar.
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+d');
  await page.keyboard.type('y');

  await sairDoBloco(page);
  // Três cursores, três trocas: com um só, sobraria `xx` no texto.
  await expect(page.locator('[data-colorido]').first()).toHaveText('y y y');
});

test('só o bloco EM FOCO paga um Monaco — os outros não', async ({ page }) => {
  // É a razão de o desenho ser esse: um caderno de trinta blocos não pode
  // montar trinta editores.
  await novoCaderno(page, `um-so-${Date.now()}`);
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await expect(page.locator('[data-bloco]')).toHaveCount(2);

  await expect(page.locator('[data-editor-do-bloco]')).toHaveCount(0);
  await bloco(page, 0).click();
  await expect(page.locator('[data-editor-do-bloco]')).toHaveCount(1);
  await bloco(page, 1).click();
  await expect(page.locator('[data-editor-do-bloco]')).toHaveCount(1);
});

test('bloco de Python roda, e a saída cai no Output (T077)', async ({ page }) => {
  // A desculpa que eu tinha escrito era "o caderno é de SQL" — e ela não era
  // verdade nem quando escrevi: o caderno já rodava JavaScript, PHP, C e C#.
  await novoCaderno(page, `py-${Date.now()}`);
  await barra(page).getByRole('button', { name: 'Add Code' }).click();

  await bloco(page, 0).getByRole('button', { name: /Linguagem do bloco/ }).click();
  await page.getByRole('option', { name: 'Python', exact: true }).click();

  await escreverNoBloco(page, 0, 'print("veio do python")');
  await bloco(page, 0).getByRole('button', { name: '▷ Run' }).click();

  await expect(page.locator('[data-output]')).toBeVisible();
  await expect(page.locator('[data-output]')).toContainText('veio do python', {
    timeout: 30_000,
  });
});

// ---------------------------------------------------------------------------
// O bloco em EDIÇÃO tem a mesma cara do bloco parado
// ---------------------------------------------------------------------------
//
// Ele descreveu assim: *"está meio quebrado ali, grudado com a parede, ele meio
// que desconfigura"*. Três causas, todas do Monaco que entra no foco (T073):
// texto colado na parede, entrelinha diferente da camada de cor, e o CodeLens
// de SQL — registrado por LINGUAGEM (spec 038) — aparecendo DENTRO do bloco,
// repetindo os três botões que a barra dele já tem.

test('o bloco em foco NÃO repete Run/Tab/JSON dentro do editor', async ({ page }) => {
  await novoCaderno(page, 'sem-codelens');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, 'select 1');

  const editor = bloco(page, 0).locator('[data-editor-do-bloco]');
  await expect(editor).toBeVisible();
  // O CodeLens do Monaco desenha os comandos em `.codelens-decoration`.
  await expect(editor.locator('.codelens-decoration')).toHaveCount(0);
});

test('entrar em edição NÃO move o texto para a parede', async ({ page }) => {
  await novoCaderno(page, 'sem-pulo');
  await barra(page).getByRole('button', { name: 'Add Code' }).click();
  await escreverNoBloco(page, 0, 'select 1');
  await sairDoBloco(page);

  // Onde o texto começa com a camada de cor, e onde ele começa com o Monaco.
  const parado = await bloco(page, 0)
    .locator('pre')
    .first()
    .evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));

  await bloco(page, 0).click();
  await bloco(page, 0).locator('[data-editor-do-bloco]').waitFor();
  const editando = await bloco(page, 0)
    .locator('.view-lines')
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);

  // Dois pixels de folga: o Monaco arredonda a própria medida.
  expect(Math.abs(parado - editando)).toBeLessThan(2);
});
