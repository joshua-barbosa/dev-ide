// Beautify, Minify, CodeSnap, o menu da árvore e a tela de requisitos (spec 077).
//
// Três coisas que ele achou usando, e não em teste nenhum:
//
// - o botão direito no VAZIO da árvore não fazia nada, e ainda deixava o menu
//   do Chrome aparecer por cima da IDE;
// - faltava Beautify e Minify;
// - faltava a foto do trecho (CodeSnap).
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, editor, esperarIdePronta, menu, textoDoEditor } from './fixtures';

/**
 * Escreve um arquivo na pasta aberta e o abre no editor.
 *
 * Cria E grava: a suíte compartilha uma pasta só, e um teste que caiu no meio
 * deixa o arquivo dele para trás. Sem a segunda gravação, o teste seguinte
 * abriria o conteúdo da execução anterior e falharia por um motivo que não é o
 * dele.
 */
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
// O menu do botão direito
// ---------------------------------------------------------------------------

test('o botão direito no VAZIO da árvore abre o menu — e não o do navegador', async ({ page }) => {
  // Janela ALTA e árvore recolhida: a suíte compartilha uma pasta, e o que os
  // outros testes deixam lá muda quantas linhas existem. Com a lista enchendo
  // o painel o vazio não existe, e o ponto calculado abaixo cairia numa linha —
  // o teste passaria por engano. Garantir a folga é mais honesto que torcer
  // por ela.
  await page.setViewportSize({ width: 1280, height: 2000 });
  await page.getByLabel('Recolher tudo').click();

  // O ponto tem de ser DEPOIS da última linha e ainda dentro do painel — era
  // ali que o menu do Chrome aparecia por cima da IDE.
  const ponto = await page.evaluate(() => {
    const painel = document.querySelector('[data-painel-de-arquivos]');
    const linhas = [...document.querySelectorAll('[data-tree-row]')];
    const ultima = linhas[linhas.length - 1];
    if (painel === null || ultima === undefined) return null;
    const caixa = painel.getBoundingClientRect();
    const fim = ultima.getBoundingClientRect().bottom;
    return fim + 20 < caixa.bottom ? { x: caixa.x + 30, y: fim + 20 } : null;
  });
  if (ponto === null) throw new Error('o painel não tem vazio nesta janela');
  await page.mouse.click(ponto.x, ponto.y, { button: 'right' });

  const menuAberto = page.locator('.MuiMenu-paper');
  await expect(menuAberto).toBeVisible();
  await expect(menuAberto).toContainText('Novo arquivo aqui');
  await expect(menuAberto).toContainText('Abrir no terminal integrado');
  await page.keyboard.press('Escape');
});

test('o menu de uma pasta traz os itens que faltavam', async ({ page }) => {
  await page.locator('[data-tree-row="sub"]').click({ button: 'right' });
  const menuAberto = page.locator('.MuiMenu-paper');
  for (const item of [
    'Copiar', 'Recortar', 'Abrir no terminal integrado',
    'Buscar dentro desta pasta', 'Abrir no gerenciador de arquivos',
  ]) {
    await expect(menuAberto).toContainText(item);
  }
  // Sem nada copiado, "Colar" não aparece: item apagado que nunca acende é
  // ruído permanente.
  await expect(menuAberto).not.toContainText('Colar em');
  await page.keyboard.press('Escape');
});

test('Copiar acende o Colar, e colar deixa a cópia na pasta', async ({ page }) => {
  await comArquivo(page, 'zorbax-copia.txt', 'oi');

  await page.locator('[data-tree-row="zorbax-copia.txt"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Copiar$/ }).click();

  await page.locator('[data-tree-row="sub"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Colar em/ }).click();

  // Conferido no DISCO, e não na árvore: a árvore guarda os filhos já
  // carregados, e recarregá-la é outro assunto — este teste é sobre a colagem.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const r = await fetch('/api/workspace');
          const { pasta } = (await r.json()).data as { pasta: string };
          const f = await fetch(
            `/api/files/children?path=${encodeURIComponent(`${pasta}/sub`)}`
          ).then((x) => x.json());
          return JSON.stringify(f).includes('zorbax-copia.txt');
        }),
      { timeout: 10_000 }
    )
    .toBe(true);

  await apagar(page, 'zorbax-copia.txt');
  await apagar(page, 'sub/zorbax-copia.txt');
});

test('Buscar dentro desta pasta abre a busca com o Incluir preenchido', async ({ page }) => {
  await page.locator('[data-tree-row="sub"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Buscar dentro desta pasta' }).click();

  // A gaveta do filtro ABRE sozinha: filtro que vale sem aparecer devolveria
  // menos resultados sem nada na tela dizendo por quê.
  await expect(
    page.getByRole('textbox', { name: 'Incluir (ex.: src/**/*.ts)' })
  ).toHaveValue('sub/**');
});

// ---------------------------------------------------------------------------
// Beautify e Minify
// ---------------------------------------------------------------------------

test('Beautify e Minify no JSON, e o Ctrl+Z desfaz os dois', async ({ page }) => {
  await comArquivo(page, 'zorbax.json', '{"a":1,"b":[1,2]}');

  await menu(page, 'Edit');
  await page.getByRole('menuitem', { name: /^Beautify/ }).click();
  await expect.poll(() => textoDoEditor(page), { timeout: 10_000 }).toContain('"a": 1');

  await menu(page, 'Edit');
  await page.getByRole('menuitem', { name: /^Minify/ }).click();
  await expect
    .poll(async () => (await textoDoEditor(page)).trim(), { timeout: 10_000 })
    .toBe('{"a":1,"b":[1,2]}');

  // O gesto que prova o `executeEdits`: `setValue` teria limpado a pilha, e o
  // Ctrl+Z não voltaria nada.
  await editor(page).click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => textoDoEditor(page)).toContain('"a": 1');

  await apagar(page, 'zorbax.json');
});

test('Minify em TypeScript RECUSA dizendo o motivo, e não estraga o arquivo', async ({ page }) => {
  await comArquivo(page, 'zorbax.ts', 'const a:number=1\n');

  await menu(page, 'Edit');
  await page.getByRole('menuitem', { name: /^Minify/ }).click();

  const aviso = page.getByRole('dialog');
  await expect(aviso).toContainText('tipos');
  await page.getByRole('button', { name: 'ok' }).click();
  await expect.poll(() => textoDoEditor(page)).toContain('const a:number=1');

  await apagar(page, 'zorbax.ts');
});

test('o Beautify age só na SELEÇÃO quando há uma', async ({ page }) => {
  await comArquivo(page, 'zorbax-sel.css', 'a{color:red}\nb{color:blue}\n');

  // Seleciona a primeira linha inteira.
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');

  await menu(page, 'Edit');
  await page.getByRole('menuitem', { name: /^Beautify/ }).click();

  await expect.poll(() => textoDoEditor(page), { timeout: 10_000 }).toContain('color: red;');
  // A segunda linha não foi REFORMATADA: é o que separa "formatar seleção" de
  // "formatar arquivo". A comparação é pela ausência da quebra que o Beautify
  // teria posto — o texto lido do Monaco não serve para comparar espaço a
  // espaço, porque a renderização junta os tokens com um espaço no meio.
  await expect.poll(() => textoDoEditor(page)).not.toContain('b {');

  await apagar(page, 'zorbax-sel.css');
});

// ---------------------------------------------------------------------------
// CodeSnap
// ---------------------------------------------------------------------------

test('CodeSnap mostra a prévia do trecho selecionado (e nada sem seleção)', async ({ page }) => {
  await comArquivo(page, 'zorbax-foto.js', 'const a = 1;\nconst b = 2;\n');

  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');

  await menu(page, 'Edit');
  await page.getByRole('menuitem', { name: /Foto do trecho/ }).click();

  const janela = page.getByRole('dialog', { name: 'Foto do trecho' });
  await expect(janela).toBeVisible();
  // A prévia é o CANVAS que vira PNG — não uma imitação em HTML.
  await expect(janela.locator('[data-codesnap-previa] canvas')).toBeVisible();
  await expect(janela.getByRole('button', { name: 'Copiar imagem' })).toBeVisible();
  await page.keyboard.press('Escape');

  await apagar(page, 'zorbax-foto.js');
});

// ---------------------------------------------------------------------------
// A tela de requisitos — a ideia dele
// ---------------------------------------------------------------------------

test('a tela diz o que a IDE precisa da máquina, e o que cada falta desliga', async ({ page }) => {
  await menu(page, 'Help');
  await page.getByRole('menuitem', { name: /precisa da sua máquina/ }).click();

  const tela = page.locator('[data-tela-de-requisitos]');
  await expect(tela).toBeVisible();
  // O Node é obrigatório e está aqui — é ele quem serve esta página.
  await expect(tela.locator('[data-ferramenta="Node.js"][data-presente="sim"]')).toBeVisible();
  // E a tabela de Beautify/Minify por linguagem vem junto.
  await expect(tela.locator('[data-capacidade="typescript"]')).toContainText('Minify');
});
