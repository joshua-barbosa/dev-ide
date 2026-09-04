// A aba do servidor e a tabela SFTP (spec 055).
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import { aba, destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';

async function abrirAbaDoServidor(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });

  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();
  await expect(aba(page, CONEXAO_SSH)).toBeVisible();

  // A aba abre no MONITOR desde a spec 056 — é o que se quer ver ao chegar num
  // servidor. Quem vai testar a tabela pede a divisória dela.
  await page.locator('[data-sub-aba="sftp"]').click();
  await expect(page.locator('[data-caminho-sftp]')).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a aba do servidor mostra só as sub-abas que a sessão SABE oferecer', async ({ page }) => {
  await abrirAbaDoServidor(page);

  // SSH expõe `files`, `shell` e — desde a spec 056 — `monitor`.
  await expect(page.locator('[data-sub-aba="sftp"]')).toBeVisible();
  await expect(page.locator('[data-sub-aba="terminal"]')).toBeVisible();
  await expect(page.locator('[data-sub-aba="monitor"]')).toBeVisible();
  // E `portas` desde a spec 059. As quatro divisórias do print dele existem
  // agora — cada uma porque a sessão declarou a capacidade dela, e não porque
  // alguém escreveu a lista. Quem prova o contrário é o FTP, cuja sessão só
  // declara `files`.
  await expect(page.locator('[data-sub-aba="portas"]')).toBeVisible();
});

test('a tabela SFTP lista com as cinco colunas e o caminho à vista', async ({ page }) => {
  await abrirAbaDoServidor(page);
  // A raiz da CONEXÃO, e não `/`: a tabela abre onde a árvore abre.
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/arvore');

  for (const coluna of ['nome', 'tamanho', 'modificado', 'tipo', 'dono']) {
    await expect(page.locator(`[data-coluna="${coluna}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' })).toBeVisible();
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: 'notas.txt' })).toContainText(
    '2.00 KB'
  );
});

test('dois cliques numa pasta ENTRA nela, e o `..` volta', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' }).dblclick();

  await expect(page.locator('[data-caminho-sftp]')).toContainText('/aplicacao');
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: 'README.md' })).toBeVisible();

  await page.locator('[data-linha-sftp=".."]').dblclick();
  await expect(page.locator('[data-caminho-sftp]')).not.toContainText('/aplicacao');
});

test('dois cliques num arquivo ABREM ele no editor', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'notas.txt' }).dblclick();
  await expect(aba(page, 'notas.txt')).toBeVisible();
});

test('ordenar por tamanho põe pasta antes, e inverte só os arquivos', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-coluna="tamanho"]').click();

  // O nome está no atributo, e não no texto: a linha inteira concatena as cinco
  // colunas, e `aplicacao` sai grudado na data.
  const nomes = async (): Promise<string[]> => {
    const caminhos = await page.locator('[data-linha-sftp]').evaluateAll((ns) =>
      ns.map((n) => n.getAttribute('data-linha-sftp') ?? '')
    );
    return caminhos.map((c) => c.split('/').pop() ?? '');
  };
  const crescente = await nomes();
  // As duas primeiras continuam sendo as pastas, em qualquer ordenação.
  expect(crescente.slice(0, 2).sort()).toEqual(['aplicacao', 'logs']);

  await page.locator('[data-coluna="tamanho"]').click();
  const decrescente = await nomes();
  expect(decrescente.slice(0, 2).sort()).toEqual(['aplicacao', 'logs']);
  // E os arquivos, esses sim, viraram de ponta-cabeça.
  expect(decrescente.slice(2)).toEqual([...crescente.slice(2)].reverse());
});

test('a sub-aba escondida NÃO é desmontada: a pasta continua onde estava', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' }).dblclick();
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/aplicacao');

  await page.locator('[data-sub-aba="terminal"]').click();
  await page.locator('[data-sub-aba="sftp"]').click();
  // Voltou para onde estava — e não para a raiz.
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/aplicacao');
});

test('abrir a aba do servidor SEM ter conectado conecta sozinho', async ({ page }) => {
  // Sem isto a aba nascia dizendo "Conectando…" para sempre: ninguém chegava a
  // conectar, porque conectar era efeito de expandir a árvore. Visto no
  // navegador (spec 055).
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();

  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

  await expect(page.locator('[data-sub-aba="sftp"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-sub-aba="sftp"]').click();
  await expect(page.locator('[data-caminho-sftp]')).toContainText('/arvore');
});

// ---------------------------------------------------------------------------
// Lote M: o menu de botão direito (T079) e baixar pasta (T089)
//
// Contra o `sshd` descartável da suíte. Nada é apagado no servidor: os itens
// destrutivos são conferidos por EXISTIREM no menu, e o menu é fechado.
// ---------------------------------------------------------------------------

test('o botão direito na tabela traz os itens do lote M (T079)', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').first().click({ button: 'right' });

  const menuAberto = page.locator('.MuiMenu-paper');
  await expect(menuAberto).toBeVisible();
  for (const item of ['Baixar', 'Copiar caminho', 'Renomear', 'Permissões', 'Excluir']) {
    await expect(menuAberto).toContainText(item);
  }
  await page.keyboard.press('Escape');
});

test('o menu de uma PASTA oferece baixar em zip (T089)', async ({ page }) => {
  await abrirAbaDoServidor(page);
  // Pela PASTA, achada pelo nome: a marca é o caminho completo, e ele depende
  // da raiz da conexão — que o teste não fixa.
  await page.locator('[data-linha-sftp]').filter({ hasText: 'aplicacao' }).first()
    .click({ button: 'right' });
  await expect(page.locator('.MuiMenu-paper')).toContainText('.zip');
  await page.keyboard.press('Escape');
});

test('excluir no servidor PERGUNTA antes, e cancelar não apaga nada', async ({ page }) => {
  await abrirAbaDoServidor(page);
  const antes = await page.locator('[data-linha-sftp]').count();

  await page.locator('[data-linha-sftp]').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Excluir' }).click();

  const dialogo = page.getByRole('dialog');
  // A pergunta diz que não há lixeira: no servidor dele isto não tem volta.
  await expect(dialogo).toContainText('lixeira');
  await page.getByRole('button', { name: 'cancelar' }).click();

  await expect(page.locator('[data-linha-sftp]')).toHaveCount(antes);
});

// A entrada de texto do SFTP, depois da spec 100.
//
// Renomear, permissões e criar usavam `window.prompt`, que dentro da webview
// do editor devolve `null` CALADO: o clique não fazia nada e não havia erro
// nenhum para investigar. Passaram a usar a entrada rápida da IDE, que é a
// mesma dos dois lados — e que, ao contrário do `prompt`, pode ser testada.
test('criar pasta pede o nome pela entrada rápida, e não por um prompt do navegador', async ({
  page,
}) => {
  // Se algum `window.prompt` voltar, este teste falha em vez de travar: a
  // caixa nativa do navegador nunca é respondida, e o clique não faz nada.
  let houvePrompt = false;
  page.on('dialog', (d) => {
    houvePrompt = true;
    void d.dismiss();
  });

  await abrirAbaDoServidor(page);
  await page.getByRole('button', { name: 'Nova pasta' }).click();

  const caixa = page.getByRole('dialog', { name: 'Nome da nova pasta' });
  await expect(caixa).toBeVisible();
  await caixa.getByRole('textbox').fill('pasta-da-spec-100');
  await page.keyboard.press('Enter');

  await expect(
    page.locator('[data-linha-sftp]').filter({ hasText: 'pasta-da-spec-100' })
  ).toBeVisible({ timeout: 30_000 });
  expect(houvePrompt).toBe(false);
});

test('renomear pede o nome NOVO já preenchido com o atual', async ({ page }) => {
  await abrirAbaDoServidor(page);
  await page.locator('[data-linha-sftp]').filter({ hasText: 'notas.txt' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renomear…' }).click();

  const caixa = page.getByRole('dialog', { name: 'Novo nome' });
  await expect(caixa).toBeVisible();
  // Já preenchido: renomear costuma ser mexer numa letra, não redigitar tudo.
  await expect(caixa.getByRole('textbox')).toHaveValue('notas.txt');
  await page.keyboard.press('Escape');
  // Escapar não renomeia nada — o arquivo continua onde estava.
  await expect(
    page.locator('[data-linha-sftp]').filter({ hasText: 'notas.txt' })
  ).toBeVisible();
});
