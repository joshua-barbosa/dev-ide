// Arquivo de preferências (spec 011).
//
// A afirmação que importa: editar o `config.json` DENTRO da IDE muda a IDE, sem
// recarregar a página. É o que faz este arquivo ser a tela de configurações em
// vez de um detalhe de implementação.
//
// Todo teste daqui devolve as preferências ao padrão no fim. A suíte compartilha
// um servidor, e preferência é estado global: deixar a fonte em 22 faria um
// teste de outro arquivo falhar por motivo que ele não menciona.
import { expect, test } from '@playwright/test';
import {
  abrirArquivo, editor, esperarEditorPronto, menu, textoDoEditor, esperarIdePronta,
} from './fixtures';

/**
 * Substitui todo o conteúdo do editor pelo texto dado.
 *
 * Parece mais complicado do que deveria, e o motivo é o **fechamento automático
 * do Monaco**. Ele insere o par de `{` e de `"` sozinho, e a edição sintética do
 * Playwright não dispara o "digitar por cima" que acontece com um teclado de
 * verdade. `{"editor.fontSize": 22}` chegava ao arquivo como
 * `{"editor.fontSize": 22}"}` — JSON inválido, e o teste falhava afirmando a
 * coisa certa pelo motivo errado.
 *
 * O que foi descartado no caminho: `keyboard.type` (mesmo problema) e a área de
 * transferência (`writeText` + `Ctrl+V` não chegou ao Monaco no Chrome sem
 * cabeça — o editor ficou intacto).
 *
 * O que funciona: inserir e **apagar o rastro**. Os fechadores automáticos ficam
 * todos à direita do cursor, empurrados para lá conforme o texto entrou — então
 * selecionar até o fim do documento e apagar limpa exatamente eles.
 */
async function escreverNoEditor(
  page: import('@playwright/test').Page,
  texto: string
): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(texto);
  await page.keyboard.press('Control+Shift+End');
  await page.keyboard.press('Delete');
}

/** Tamanho da fonte que o editor está de fato usando, em pixels. */
async function fonteDoEditor(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const linhas = document.querySelector('[data-editor] .view-lines');
    return linhas === null ? 0 : Number.parseFloat(getComputedStyle(linhas).fontSize);
  });
}

async function preferencias(page: import('@playwright/test').Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const r = await fetch('/api/prefs');
    return (await r.json()).data as Record<string, unknown>;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test.afterEach(async ({ page }) => {
  // Volta ao padrão pela rota, e não pelo editor: é o caminho mais curto e não
  // depende de nenhuma aba estar aberta.
  await page.evaluate(() =>
    fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'editor.fontSize': 13,
        'editor.wordWrap': false,
        'editor.tabSize': 4,
        'workbench.theme': 'escuro',
      }),
    })
  );
  // E o `.vscode/settings.json` do projeto some: ele é estado do DISCO, e
  // deixá-lo faria os testes de árvore de outro arquivo verem uma pasta a mais.
  await page.evaluate(async () => {
    const r = await fetch('/api/prefs/project');
    const { path } = (await r.json()).data as { path: string | null };
    if (path === null) return;
    await fetch('/api/workspace/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.slice(0, path.lastIndexOf('/')) }),
    });
  });
});

test('File → Preferences abre o config.json no editor', async ({ page }) => {
  await menu(page, 'File');
  // Ancorado: `Preferences` virou prefixo de `Preferences (config.json)` no
  // T001, e o nome solto casa com os dois.
  await page.getByRole('menuitem', { name: /^Preferences \(config\.json\)/ }).click();

  await expect(page.locator('[data-tab="config.json"]')).toBeVisible();
  // Vem com os padrões, e não vazio: o arquivo é criado se ainda não existir.
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);
});

test('editar a fonte no config.json muda o editor ao salvar, sem recarregar', async ({ page }) => {
  await menu(page, 'File');
  // Ancorado: `Preferences` virou prefixo de `Preferences (config.json)` no
  // T001, e o nome solto casa com os dois.
  await page.getByRole('menuitem', { name: /^Preferences \(config\.json\)/ }).click();
  await esperarEditorPronto(page);
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);

  const antes = await fonteDoEditor(page);
  expect(antes).toBe(13);

  await escreverNoEditor(page, '{"editor.fontSize": 22}');
  await expect.poll(() => textoDoEditor(page)).toBe('{"editor.fontSize": 22}');
  await page.keyboard.press('Control+s');

  // Sem F5 no meio: é a promessa da AC-14.
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(22);
});

test('JSON quebrado no config.json não derruba a IDE', async ({ page }) => {
  await menu(page, 'File');
  // Ancorado: `Preferences` virou prefixo de `Preferences (config.json)` no
  // T001, e o nome solto casa com os dois.
  await page.getByRole('menuitem', { name: /^Preferences \(config\.json\)/ }).click();
  await esperarEditorPronto(page);
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);

  // Sai do padrão ANTES de quebrar o arquivo. Sem este passo o teste passaria
  // mesmo que salvar não fizesse nada — 13 já era o valor.
  await escreverNoEditor(page, '{"editor.fontSize": 22}');
  await page.keyboard.press('Control+s');
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(22);

  await escreverNoEditor(page, 'isto não é json,,,');
  await page.keyboard.press('Control+s');

  // O editor continua de pé e as preferências voltam ao padrão — que é o sinal
  // honesto de "não entendi seu arquivo".
  await expect(editor(page).locator('.monaco-editor')).toBeVisible();
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(13);
});

test('Word Wrap persiste depois de recarregar a página', async ({ page }) => {
  expect((await preferencias(page))['editor.wordWrap']).toBe(false);

  await menu(page, 'View');
  await page.getByRole('menuitem', { name: 'Word Wrap' }).click();

  await expect.poll(async () => (await preferencias(page))['editor.wordWrap']).toBe(true);

  // O ponto do item: a ação do Monaco alternaria e esqueceria.
  await page.reload();
  expect((await preferencias(page))['editor.wordWrap']).toBe(true);
});

test('a rota recusa preferência desconhecida', async ({ page }) => {
  const resposta = await page.evaluate(async () => {
    const r = await fetch('/api/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'algo.inventado': 1 }),
    });
    return (await r.json()) as { success: boolean; error: string | null };
  });

  expect(resposta.success).toBe(false);
  expect(resposta.error).toMatch(/desconhecida/);
});

// ---------------------------------------------------------------------------
// A tela de configurações (T001) e as preferências do projeto (T002)
// ---------------------------------------------------------------------------
//
// A nota dele no T001: *"as duas formas, como o VS Code: tela com campos + o
// config.json, lendo e escrevendo o mesmo arquivo."*

const tela = (page: import('@playwright/test').Page) =>
  page.locator('[data-tela-de-preferencias]');

async function abrirTela(page: import('@playwright/test').Page): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Preferences$/ }).click();
  await expect(tela(page)).toBeVisible();
}

test('File → Preferences abre a TELA, e o item ao lado abre o arquivo', async ({ page }) => {
  await abrirTela(page);
  // Os campos saem do esquema: quem chega vê preferência de verdade, com o
  // nome da chave embaixo para achar a mesma coisa no arquivo.
  await expect(tela(page).locator('[data-preferencia="editor.fontSize"]')).toBeVisible();
  await expect(tela(page).locator('[data-preferencia="workbench.theme"]')).toBeVisible();

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Preferences \(config\.json\)/ }).click();
  await expect.poll(() => textoDoEditor(page)).toMatch(/"editor\.fontSize"/);
});

test('mudar na tela grava no MESMO arquivo, e o editor mostra', async ({ page }) => {
  await abrirTela(page);
  // `exact`: o rótulo é prefixo do "Tamanho da fonte do terminal".
  const campo = tela(page).getByLabel('Tamanho da fonte', { exact: true });
  await campo.fill('19');
  await campo.blur();

  // O arquivo é o mesmo das duas formas: o que a tela grava, a rota devolve.
  await expect.poll(async () => (await preferencias(page))['editor.fontSize']).toBe(19);

  // E o editor de verdade usa: abre um arquivo, porque com a aba de
  // configurações à frente o Monaco está escondido e não tem o que medir.
  await abrirArquivo(page, 'utils.ts');
  await esperarEditorPronto(page);
  await expect.poll(() => fonteDoEditor(page), { timeout: 10_000 }).toBe(19);
});

test('o tema escolhido na tela repinta a IDE', async ({ page }) => {
  await abrirTela(page);
  await tela(page).getByLabel('Tema', { exact: true }).click();
  await page.getByRole('option', { name: 'Nord' }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('footer');
        return el === null ? '' : getComputedStyle(el).backgroundColor;
      })
    )
    // `#3b4252` do Nord.
    .toBe('rgb(59, 66, 82)');
});

test('a preferência do PROJETO vence, e a tela avisa (T002)', async ({ page }) => {
  // Escreve o `.vscode/settings.json` pela própria IDE: o caminho vem do
  // servidor, então o teste não precisa saber onde a pasta demo mora.
  await page.evaluate(async () => {
    const r = await fetch('/api/prefs/project/file', { method: 'POST' });
    const { path } = (await r.json()).data as { path: string };
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content: JSON.stringify({ 'editor.tabSize': 2 }) }),
    });
  });
  await page.reload();
  await esperarIdePronta(page);
  await abrirTela(page);

  await expect(tela(page).locator('[data-sobrescrita="editor.tabSize"]')).toBeVisible();
  await expect(tela(page).locator('[data-sobrescrita="editor.tabSize"]')).toContainText(
    '.vscode/settings.json'
  );
  expect((await preferencias(page))['editor.tabSize']).toBe(2);

  // Gravar pela tela continua indo para o arquivo do USUÁRIO — e o projeto
  // continua mandando. É o que o aviso explica.
  const campo = tela(page).getByLabel('Tamanho da tabulação', { exact: true });
  await campo.fill('8');
  await campo.blur();
  await expect.poll(async () => (await preferencias(page))['editor.tabSize']).toBe(2);
});

test('chave que a IDE não conhece no settings.json do projeto é ignorada', async ({ page }) => {
  await page.evaluate(async () => {
    const r = await fetch('/api/prefs/project/file', { method: 'POST' });
    const { path } = (await r.json()).data as { path: string };
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        // Um `settings.json` de verdade vem cheio de chaves do VS Code.
        content: JSON.stringify({ 'editor.formatOnSave': true, 'files.eol': '\n' }),
      }),
    });
  });
  await page.reload();
  await esperarIdePronta(page);
  await abrirTela(page);

  await expect(tela(page).locator('[data-sobrescrita]')).toHaveCount(0);
});
