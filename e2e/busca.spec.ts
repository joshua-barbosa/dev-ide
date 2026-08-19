// Painel de busca e substituição (spec 027).
//
// O que decide o que casa é testado sem navegador, em
// `shared/__tests__/busca.test.ts`; os tetos e a recusa de caminho de fora, em
// `server/__tests__/busca.routes.test.ts`. Aqui se prova o caminho: digitar,
// ver os arquivos, clicar num resultado e trocar o conteúdo — inclusive o
// arquivo que está ABERTO no editor, que é onde uma substituição silenciosa
// mais estraga.
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, esperarEditorPronto, menu, painelLateral, textoDoEditor } from './fixtures';

/**
 * Um termo por teste.
 *
 * A suíte compartilha UMA pasta e os arquivos que cada teste cria ficam lá:
 * um termo só faria o teste seguinte contar as sobras do anterior — e a falha
 * aparece só na suíte inteira, nunca ao rodar o teste sozinho.
 */
const termo = (sufixo: string): string => `ZORBAX${sufixo}`;

const campoBusca = (page: Page) => page.getByLabel('Pesquisar', { exact: true });
const campoTroca = (page: Page) => page.getByLabel('Substituir por');
const resumo = (page: Page) => page.locator('[data-resumo-busca]');
const arquivo = (page: Page, nome: string) => page.locator(`[data-arquivo-busca="${nome}"]`);
const ocorrencia = (page: Page, nome: string, linha: number) =>
  page.locator(`[data-ocorrencia="${nome}:${linha}"]`);

/** Cria um arquivo na pasta aberta, pelo caminho que o usuário usaria. */
async function criarArquivo(page: Page, nome: string, conteudo: string): Promise<void> {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  await page.keyboard.insertText(conteudo);

  await menu(page, 'File');
  await page.getByRole('menuitem', { name: /^Save/ }).first().click();
  await entradaRapida(page).fill(nome);
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-tab="${nome}"]`)).toBeVisible();
}

async function procurar(page: Page, termo: string): Promise<void> {
  await painelLateral(page, 'Search').click();
  await campoBusca(page).fill(termo);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('acha o termo, agrupado por arquivo, com a linha certa', async ({ page }) => {
  const TERMO = termo('ACHA');
  await criarArquivo(page, 'busca-um.txt', `alfa ${TERMO}\nbeta\n${TERMO} de novo\n`);
  await criarArquivo(page, 'busca-dois.txt', `nada aqui\num ${TERMO}\n`);
  await criarArquivo(page, 'busca-tres.txt', 'sem nenhum\n');

  await procurar(page, TERMO);

  await expect(resumo(page)).toHaveText('3 em 2 arquivo(s)');
  await expect(arquivo(page, 'busca-um.txt')).toBeVisible();
  await expect(arquivo(page, 'busca-dois.txt')).toBeVisible();
  await expect(arquivo(page, 'busca-tres.txt')).toHaveCount(0);
  await expect(ocorrencia(page, 'busca-um.txt', 1)).toBeVisible();
  await expect(ocorrencia(page, 'busca-um.txt', 3)).toBeVisible();
});

test('termo apagado limpa o resultado, sem erro na tela', async ({ page }) => {
  const TERMO = termo('APAGA');
  await criarArquivo(page, 'busca-apaga.txt', `${TERMO}\n`);

  await procurar(page, TERMO);
  await expect(resumo(page)).toContainText('arquivo(s)');

  await campoBusca(page).fill('');
  await expect(resumo(page)).toHaveText('');
  await expect(page.locator('[data-arquivo-busca]')).toHaveCount(0);
});

test('o modo regex só vale quando pedido', async ({ page }) => {
  const TERMO = termo('REGEX');
  await criarArquivo(page, 'busca-regex.txt', `${TERMO}xb\n${TERMO}.b\n`);

  // Como literal, o ponto é ponto: casa uma linha só.
  await procurar(page, `${TERMO}.b`);
  await expect(resumo(page)).toHaveText('1 em 1 arquivo(s)');

  await page.getByRole('button', { name: '.*', exact: true }).click();
  await expect(resumo(page)).toHaveText('2 em 1 arquivo(s)');
});

test('expressão inválida avisa no próprio campo, sem diálogo', async ({ page }) => {
  await procurar(page, '(');
  await page.getByRole('button', { name: '.*', exact: true }).click();

  await expect(page.getByText('expressão inválida')).toBeVisible();
  // E não some do ar: nada de caixa de erro a cada tecla digitada.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('clicar num resultado abre o arquivo NA LINHA da ocorrência', async ({ page }) => {
  const TERMO = termo('IR');
  await criarArquivo(page, 'busca-ir.txt', `um\ndois\ntres ${TERMO}\n`);
  await procurar(page, TERMO);

  await ocorrencia(page, 'busca-ir.txt', 3).click();
  await expect(page.locator('[data-tab="busca-ir.txt"]')).toBeVisible();
  await expect(page.locator('footer')).toContainText('Ln 3, Col 6');
});

test('substitui num arquivo só, deixando o outro intacto', async ({ page }) => {
  const TERMO = termo('UM');
  await criarArquivo(page, 'troca-um.txt', `${TERMO} aqui\n`);
  await criarArquivo(page, 'troca-dois.txt', `${TERMO} ali\n`);

  await procurar(page, TERMO);
  await campoTroca(page).fill('TROCADO');
  await page.getByRole('button', { name: 'Substituir em troca-um.txt' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'substituir' }).click();

  // A busca se refaz sozinha: sobra só o arquivo que não foi tocado.
  await expect(resumo(page)).toHaveText('1 em 1 arquivo(s)');
  await expect(arquivo(page, 'troca-dois.txt')).toBeVisible();
  await expect(arquivo(page, 'troca-um.txt')).toHaveCount(0);
});

test('substitui em todos de uma vez', async ({ page }) => {
  const TERMO = termo('TODOS');
  await criarArquivo(page, 'todos-um.txt', `${TERMO} ${TERMO}\n`);
  await criarArquivo(page, 'todos-dois.txt', `${TERMO}\n`);

  await procurar(page, TERMO);
  await campoTroca(page).fill('TROCADO');
  await page.getByRole('button', { name: 'Substituir em todos' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'substituir' }).click();

  await expect(resumo(page)).toHaveText('Nenhum resultado.');
});

test('cancelar a confirmação NÃO mexe em arquivo nenhum', async ({ page }) => {
  const TERMO = termo('CANCELA');
  await criarArquivo(page, 'cancela.txt', `${TERMO} intacto\n`);

  await procurar(page, TERMO);
  await campoTroca(page).fill('TROCADO');
  await page.getByRole('button', { name: 'Substituir em todos' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /cancelar/i }).click();

  await expect(resumo(page)).toHaveText('1 em 1 arquivo(s)');
});

test('o arquivo ABERTO no editor mostra o texto novo depois da troca', async ({ page }) => {
  const TERMO = termo('ABERTO');
  // Sem isto a aba segue com o texto de antes, e salvá-la desfaz a
  // substituição em silêncio — o pior desfecho possível.
  await criarArquivo(page, 'aberto.txt', `${TERMO} na tela\n`);

  await procurar(page, TERMO);
  await campoTroca(page).fill('TROCADO');
  await page.getByRole('button', { name: 'Substituir em todos' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'substituir' }).click();
  await expect(resumo(page)).toHaveText('Nenhum resultado.');

  await expect.poll(() => textoDoEditor(page)).toContain('TROCADO na tela');
});
