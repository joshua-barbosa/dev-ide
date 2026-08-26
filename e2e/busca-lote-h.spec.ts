// Filtro, prévia e desfazer na busca (T031, T033, T032 · spec 027).
//
// Os três vinham de `Non-Goals` da spec 027. Num eu escrevi "entra quando doer",
// noutro "o caminho hoje é o git, e é honesto", e no terceiro não escrevi nada —
// só listei.
import { expect, test, type Page } from '@playwright/test';
import {
  entradaRapida, esperarEditorPronto, esperarIdePronta, menu, painelLateral,
} from './fixtures';

/**
 * Um termo POR TESTE.
 *
 * Duas armadilhas resolvidas de uma vez. A primeira: os arquivos são criados
 * aqui, e não presumidos — a pasta de teste não tem `function` em lugar nenhum,
 * e a versão anterior procurava por isso e recebia "Nenhum resultado",
 * passando a testar o vazio.
 *
 * A segunda: os testes COMPARTILHAM a pasta e os arquivos se acumulam. Com um
 * termo só, o teste do desfazer achava o arquivo do teste anterior e contava
 * "2 em 2 arquivo(s)" onde esperava um.
 */
let proximo = 0;
const novoTermo = (): string => `ALVO-LOTE-H-${(proximo += 1)}`;

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

const resumo = (page: Page) => page.locator('[data-resumo-busca]');


async function abrirBusca(page: Page): Promise<void> {
  await painelLateral(page, 'Search').click();
  await expect(page.getByLabel('Pesquisar', { exact: true })).toBeVisible();
}

async function procurar(page: Page, termo: string): Promise<void> {
  await page.getByLabel('Pesquisar', { exact: true }).fill(termo);
  // A busca tem atraso de 300 ms; esperar o resumo mudar é o sinal de pronta.
  await expect(resumo(page)).not.toHaveText('procurando…', { timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o filtro por arquivo fica ESCONDIDO até alguém pedir', async ({ page }) => {
  await abrirBusca(page);
  // Dois campos sempre abertos empurrariam a lista de resultados para baixo em
  // toda busca — e eles são úteis e raros.
  await expect(page.getByLabel('Incluir')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filtrar por arquivo' }).click();
  await expect(page.getByLabel('Incluir')).toBeVisible();
  await expect(page.getByLabel('Excluir')).toBeVisible();
});

test('`include` limita a busca ao que casa', async ({ page }) => {
  const termo = novoTermo();
  await criarArquivo(page, 'lote-h-um.txt', `${termo}\n`);
  await criarArquivo(page, 'lote-h-dois.md', `${termo}\n`);

  await abrirBusca(page);
  await procurar(page, termo);
  await expect(resumo(page)).toContainText('2 arquivo(s)');

  await page.getByRole('button', { name: 'Filtrar por arquivo' }).click();
  await page.getByLabel('Incluir').fill('*.md');
  // Um arquivo, e não dois: o `.txt` ficou de fora.
  await expect(resumo(page)).toContainText('1 arquivo(s)', { timeout: 15_000 });
});

test('`exclude` tira, e o filtro ativo APARECE mesmo fechado', async ({ page }) => {
  const termo = novoTermo();
  await criarArquivo(page, 'lote-h-tres.txt', `${termo}\n`);
  await criarArquivo(page, 'lote-h-quatro.md', `${termo}\n`);

  await abrirBusca(page);
  await page.getByRole('button', { name: 'Filtrar por arquivo' }).click();
  await page.getByLabel('Excluir').fill('**/*.md');
  await procurar(page, termo);

  // Fechar o filtro não pode esconder que ele está valendo: uma busca filtrada
  // que parece completa é a pior leitura possível do resultado.
  await page.getByRole('button', { name: 'Filtrar por arquivo' }).click();
  await expect(page.getByText('filtro ativo')).toBeVisible();
});

test('a prévia mostra como a linha vai FICAR, e só quando muda', async ({ page }) => {
  const termo = novoTermo();
  await criarArquivo(page, 'lote-h-previa.txt', `linha com ${termo} dentro\n`);
  await abrirBusca(page);
  await procurar(page, termo);
  // Sem substituto não há o que prever.
  await expect(page.locator('[data-previa-da-substituicao]').first()).toHaveCount(0);

  await page.getByLabel('Substituir por').fill('TROCADO-PELO-TESTE');
  await expect(page.locator('[data-previa-da-substituicao]').first()).toBeVisible();
  await expect(page.locator('[data-previa-da-substituicao]').first()).toContainText('TROCADO-PELO-TESTE');
});

test('substituto IGUAL ao termo não gera prévia — seriam duas linhas iguais', async ({ page }) => {
  const termo = novoTermo();
  await criarArquivo(page, 'lote-h-igual.txt', `linha com ${termo} dentro\n`);
  await abrirBusca(page);
  await procurar(page, termo);
  await page.getByLabel('Substituir por').fill(termo);
  await expect(page.locator('[data-previa-da-substituicao]')).toHaveCount(0);
});

test('o desfazer só aparece DEPOIS de substituir', async ({ page }) => {
  await abrirBusca(page);
  // Um aviso de desfazer permanente seria ruído; ele nasce da ação.
  await expect(page.locator('[data-desfazer-substituicao]')).toHaveCount(0);
});

test('substituir e DESFAZER devolve o arquivo ao que era', async ({ page }) => {
  // Na spec 027 eu escrevi que "o caminho hoje é o git, e é honesto". Era
  // honesto e insuficiente: em pasta sem git não há volta nenhuma, e trocar em
  // quarenta arquivos é fácil de fazer por engano.
  const termo = novoTermo();
  await criarArquivo(page, 'lote-h-desfazer.txt', `antes ${termo} depois\n`);

  await abrirBusca(page);
  await procurar(page, termo);
  await expect(resumo(page)).toContainText('1 arquivo(s)');

  await page.getByLabel('Substituir por').fill('SUBSTITUIDO');
  await page.getByRole('button', { name: 'Substituir em todos' }).click();
  await page.getByRole('button', { name: /substituir/i }).last().click();

  // O termo sumiu do disco.
  await expect(resumo(page)).toContainText('Nenhum resultado.', { timeout: 15_000 });
  // E o desfazer apareceu, porque houve o que desfazer.
  await expect(page.locator('[data-desfazer-substituicao]')).toBeVisible();

  await page.getByRole('button', { name: 'Desfazer a substituição' }).click();
  // O termo voltou: o conteúdo anterior foi restaurado arquivo a arquivo.
  await expect(resumo(page)).toContainText('1 arquivo(s)', { timeout: 15_000 });
  // E o aviso some — não há mais o que desfazer.
  await expect(page.locator('[data-desfazer-substituicao]')).toHaveCount(0);
});

test('o desfazer devolve o texto ao EDITOR, e não só ao disco', async ({ page }) => {
  const termo = novoTermo();
  await criarArquivo(page, 'lote-h-aba.txt', `abre ${termo} fecha\n`);

  await abrirBusca(page);
  await procurar(page, termo);
  await page.getByLabel('Substituir por').fill('TROCADO');
  await page.getByRole('button', { name: 'Substituir em todos' }).click();
  await page.getByRole('button', { name: /substituir/i }).last().click();
  await expect(resumo(page)).toContainText('Nenhum resultado.', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Desfazer a substituição' }).click();
  await expect(resumo(page)).toContainText('1 arquivo(s)', { timeout: 15_000 });

  // A aba estava aberta o tempo todo. Se ela não recarregar, o usuário salva
  // por cima do desfazer sem perceber — que é pior que não ter desfazer.
  await page.locator('[data-tab="lote-h-aba.txt"]').click();
  await expect(page.locator('.monaco-editor').first()).toContainText(termo, { timeout: 10_000 });
});
