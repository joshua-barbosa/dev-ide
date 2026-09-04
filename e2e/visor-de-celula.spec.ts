// O visor de célula — a lupa (spec 062, fase D · item T062 da triagem).
//
// Ele existe porque a grade mostra o valor cortado na largura da coluna, e há
// colunas em que o que interessa nunca cabe. O que estes testes guardam é o que
// nenhum deles poderia adivinhar: o modo JSON só aparece quando o valor É JSON,
// e salvar aqui NÃO escreve no banco — alimenta o rascunho.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA, TABELA_EDITAVEL } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirTabela(page: Page, tabela: string = TABELA): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, tabela).hover();
  await page.getByRole('button', { name: `Abrir tabela ${tabela}`, exact: true }).click();
  await expect(aba(page, tabela)).toBeVisible();
}

/** Roda um SQL na aba e espera a coluna nova aparecer. */
async function rodar(page: Page, sql: string, coluna: string): Promise<void> {
  await page.locator('[data-sql-da-tabela]').fill(sql);
  await page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' }).click();
  await expect(page.locator(`[data-coluna="${coluna}"]`)).toBeVisible();
}

const visor = (page: Page) => page.locator('[data-visor-de-celula]');
const caixa = (page: Page) => page.locator('[data-valor-da-celula]');

async function abrirLupa(page: Page, texto: string): Promise<void> {
  const celula = page.locator('[data-grade] tbody td', { hasText: texto }).first();
  await celula.hover();
  await celula.getByRole('button', { name: 'Ver o valor inteiro' }).click();
  await expect(visor(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a lupa só aparece com o mouse em cima, e abre o valor inteiro', async ({ page }) => {
  await abrirTabela(page);
  const celula = page.locator('[data-grade] tbody td', { hasText: 'joshua' }).first();

  // Uma lupa por célula, sempre visível, encheria a grade de ícones.
  const lupa = celula.getByRole('button', { name: 'Ver o valor inteiro' });
  expect(await lupa.evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
  await celula.hover();
  expect(await lupa.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');

  await lupa.click();
  await expect(visor(page)).toBeVisible();
  await expect(caixa(page)).toHaveValue('joshua');
});

test('o valor longo aparece INTEIRO, e não cortado como na grade', async ({ page }) => {
  await abrirTabela(page);
  const longo = 'A'.repeat(600);
  await rodar(page, `select '${longo}' as bem_longo`, 'bem_longo');
  await abrirLupa(page, 'AAAA');
  await expect(caixa(page)).toHaveValue(longo);
});

test('quando é JSON, o visor abre já indentado e oferece o modo JSON', async ({ page }) => {
  await abrirTabela(page);
  await rodar(page, `select '{"id":1,"itens":[2,3]}' as dados`, 'dados');
  await abrirLupa(page, '"id"');

  // Abre no modo JSON: é para isso que se abre um JSON.
  await expect(visor(page).getByRole('tab', { name: 'json' })).toHaveAttribute('aria-selected', 'true');
  const texto = await caixa(page).inputValue();
  expect(texto).toContain('\n');
  expect(texto).toContain('"itens"');
});

test('quando NÃO é JSON, o modo JSON nem existe', async ({ page }) => {
  await abrirTabela(page);
  await abrirLupa(page, 'joshua');
  // Botão que não faz nada é pior que botão ausente — a mesma regra da spec 041.
  await expect(visor(page).getByRole('tab', { name: 'json' })).toHaveCount(0);
});

test('um número solto NÃO conta como JSON', async ({ page }) => {
  await abrirTabela(page);
  await rodar(page, 'select 42 as resposta', 'resposta');
  await abrirLupa(page, '42');
  // `JSON.parse('42')` funciona, mas oferecer o modo JSON numa coluna de id
  // seria um botão inútil em toda linha.
  await expect(visor(page).getByRole('tab', { name: 'json' })).toHaveCount(0);
});

test('salvar no visor alimenta o RASCUNHO, e não grava no banco', async ({ page }) => {
  await abrirTabela(page);
  await abrirLupa(page, 'joshua');
  await caixa(page).fill('joshua editado no visor');
  await visor(page).getByRole('button', { name: 'Salvar no rascunho' }).click();

  await expect(visor(page)).toHaveCount(0);
  // A célula fica marcada como mexida, e a barra de rascunho aparece — que é
  // quem grava, com o SQL à vista e a confirmação (spec 044).
  await expect(page.getByText('joshua editado no visor')).toBeVisible();
  await expect(page.getByRole('button', { name: /Gravar/i })).toBeVisible();
});

test('a chave primária abre só para leitura, e diz por quê', async ({ page }) => {
  await abrirTabela(page);
  // A coluna `id` é a chave primária desta tabela. Apontada pelo NOME: contar
  // `td` quebrava a cada coluna de controle nova, e sem dizer por quê.
  const celula = page
    .locator('[data-grade] tbody tr')
    .first()
    .locator('[data-celula-da-coluna="id"]');
  await celula.hover();
  await celula.getByRole('button', { name: 'Ver o valor inteiro' }).click();

  await expect(caixa(page)).toHaveAttribute('readonly', '');
  await expect(visor(page).getByText(/chave primária/i)).toBeVisible();
  await expect(visor(page).getByRole('button', { name: 'Salvar no rascunho' })).toHaveCount(0);
});

test('reabrir noutra célula mostra o valor NOVO, e não o anterior', async ({ page }) => {
  await abrirTabela(page);
  await abrirLupa(page, 'joshua');
  await expect(caixa(page)).toHaveValue('joshua');
  await visor(page).getByRole('button', { name: 'Fechar' }).click();

  await abrirLupa(page, 'maria');
  // Mostrar o valor da célula anterior é o pior tipo de erro: silencioso, e
  // plausível o bastante para ninguém desconfiar.
  await expect(caixa(page)).toHaveValue('maria');
});

test('o JSON sai COLORIDO, e não em texto de uma cor só', async ({ page }) => {
  await abrirTabela(page);
  await rodar(page, `select '{"id":1,"nome":"a"}' as dados`, 'dados');
  await abrirLupa(page, '"id"');

  // O Monaco emite CLASSES (`mtk7`), não estilo em linha — por isso a leitura
  // é do estilo COMPUTADO. Um teste que olhasse `style.color` passaria vazio.
  //
  // `poll` e não uma leitura só: o tokenizador do JSON entra por um caminho
  // assíncrono, e a primeira colorização de uma página que nunca abriu JSON
  // chega antes dele. `colorir.ts` tenta de novo — e é essa segunda tentativa
  // que este teste precisa esperar. Uma leitura única mediria o instante errado.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const pre = document.querySelector('[data-visor-de-celula] pre');
          if (pre === null) return 0;
          return new Set(
            [...pre.querySelectorAll('span')].map((s) => getComputedStyle(s).color)
          ).size;
        }),
      { timeout: 5000 }
    )
    // Chave, número e delimitador em cores diferentes. Tudo igual = uma só.
    .toBeGreaterThan(1);
});

// ---- O valor que a grade cortou ----
//
// Achado por ele usando: um JSON de simulado abria na lupa parando no meio de
// `"nota":…`. O servidor corta cada célula em 2048 caracteres para a página não
// arrastar megabytes; o visor promete "o valor inteiro" e mostrava o recorte,
// com as reticências do servidor no fim e nada dizendo que faltava coisa.

/** Um texto seguramente acima do teto de 2048 do servidor. */
const GIGANTE = 'ABCDEFGHIJ'.repeat(400); // 4000 caracteres

test('a lupa mostra o valor INTEIRO, mesmo quando a grade cortou', async ({ page }) => {
  // `alunos_edicao`, e NUNCA `alunos`: o `global-setup` registra que escrever
  // na tabela de leitura já quebrou três testes de outras specs.
  await abrirTabela(page, TABELA_EDITAVEL);
  await page.locator('[data-sql-da-tabela]').fill(
    `update ${TABELA_EDITAVEL} set nome = '${GIGANTE}' where id = 1`
  );
  await page.getByRole('button', { name: 'Executar este SQL (Ctrl+Enter)' }).click();
  await expect(page.locator('[data-modo-livre]')).toBeVisible();

  // De volta ao SQL da tabela: é lá que a IDE sabe a chave primária, e sem ela
  // não há como buscar o valor inteiro de uma linha só.
  await page.getByRole('button', { name: 'Voltar ao SQL da tabela' }).click();
  await expect(page.locator('[data-coluna="nome"]')).toBeVisible();

  const naGrade = await page.evaluate(() => {
    const td = [...document.querySelectorAll('[data-grade] tbody td')].find((e) =>
      (e.textContent ?? '').startsWith('ABCDEFGHIJ')
    );
    return td?.textContent ?? '';
  });
  // A grade recebe o recorte do servidor — e isso é o comportamento CERTO dela.
  expect(naGrade.length).toBeLessThan(GIGANTE.length);
  expect(naGrade.endsWith('…')).toBe(true);

  // A lupa, não. Ela pede de novo, uma célula por vez, e sem corte.
  await abrirLupa(page, 'ABCDEFGHIJ');
  await expect.poll(() => caixa(page).inputValue().then((v) => v.length), { timeout: 5000 })
    .toBe(GIGANTE.length);
  await expect(visor(page).locator('[data-corte]')).toHaveCount(0);
});

test('sem chave primária a lupa não promete o que não pode: avisa que está cortado', async ({ page }) => {
  await abrirTabela(page);
  await rodar(page, `select '${GIGANTE}' as gigante`, 'gigante');
  await abrirLupa(page, 'ABCDEFGHIJ');
  // Em SQL livre a IDE não sabe qual linha é. O aviso é a diferença entre
  // "cortado, e eu te aviso" e uma promessa quebrada em silêncio.
  await expect(visor(page).locator('[data-corte]')).toBeVisible();
});
