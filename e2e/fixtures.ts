// Atalhos de página compartilhados pela suíte.
//
// A regra que mais importa aqui: quem dispara `prompt` ou `confirm` precisa
// registrar o tratador ANTES da ação. Um diálogo sem resposta trava a execução
// até o tempo limite, e o erro não diz o motivo.
import { expect, type Locator, type Page } from '@playwright/test';

export const linhaArvore = (page: Page, rotulo: string): Locator =>
  page.locator(`[data-tree-row="${rotulo}"]`);

export const aba = (page: Page, titulo: string): Locator =>
  page.locator(`[data-tab="${titulo}"]`);

/**
 * A área do editor.
 *
 * Desde a spec 010 é o Monaco, e não uma `textarea` — então `toHaveValue` não
 * serve mais: o conteúdo vive no modelo do editor, não num atributo do DOM.
 * Para ler o texto, use `textoDoEditor`. Para digitar, clique aqui e use o
 * teclado; o Monaco tem uma textarea escondida que recebe as teclas.
 */
export const editor = (page: Page): Locator => page.locator('[data-editor]');

/**
 * O texto visível no editor. Substitui as asserções de `value`.
 *
 * O `replace` não é enfeite: o Monaco renderiza espaços como **espaço
 * inquebrável** (U+00A0). O texto lido parece idêntico ao esperado e não casa
 * com `/SELECT \* FROM alunos/` — uma falha que gasta um bom tempo até alguém
 * comparar os códigos dos caracteres.
 */
export async function textoDoEditor(page: Page): Promise<string> {
  const bruto = await page.locator('[data-editor] .view-lines').innerText();
  return bruto.replace(/\u00a0/g, ' ');
}

/** Posição do cursor, como linha e coluna — é o que o rodapé mostra. */
export async function cursorDoEditor(page: Page): Promise<string> {
  const texto = (await rodape(page).innerText()).match(/Ln \d+, Col \d+/);
  return texto === null ? '' : texto[0];
}

export const rodape = (page: Page): Locator => page.locator('footer');

export const painelLateral = (page: Page, nome: string): Locator =>
  page.getByRole('tab', { name: nome });

/** Abre um arquivo pela árvore e espera a aba aparecer. */
export async function abrirArquivo(page: Page, nome: string): Promise<void> {
  await linhaArvore(page, nome).click();
  await expect(aba(page, nome)).toBeVisible();
}

/** Expande nós da árvore de conexões, um por vez, esperando cada filho surgir. */
export async function expandir(page: Page, ...rotulos: string[]): Promise<void> {
  for (const rotulo of rotulos) {
    await linhaArvore(page, rotulo).click();
  }
}

/** Responde ao próximo diálogo. Registrar ANTES da ação que o abre. */
export function responderDialogo(page: Page, resposta: string | boolean): void {
  page.once('dialog', (dialogo) => {
    if (resposta === false) return void dialogo.dismiss();
    return void dialogo.accept(typeof resposta === 'string' ? resposta : '');
  });
}

/**
 * Digita no editor sem salvar, deixando a aba suja.
 *
 * `Ctrl+End` em vez de `End`: o Monaco leva ao fim do documento, e não ao fim
 * da linha — que é o que os testes esperam ao acrescentar conteúdo.
 */
export async function digitar(page: Page, texto: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(texto);
}

/**
 * Responde ao diálogo da senha mestra.
 *
 * Ao contrário de `responderDialogo`, este roda DEPOIS da ação que abre o
 * diálogo: é um componente da página, não um diálogo do navegador, então
 * precisa existir no DOM para ser preenchido.
 */
export async function destrancarCofre(
  page: Page,
  senha: string,
  opcoes: { readonly lembrar?: boolean } = {}
): Promise<void> {
  const campo = page.getByLabel('Senha mestra');
  await campo.fill(senha);
  if (opcoes.lembrar === true) {
    await page.getByRole('checkbox', { name: /Lembrar neste computador/ }).check();
  }
  await page.getByRole('button', { name: 'destrancar' }).click();
}

/** Abre um menu da barra superior. */
export async function menu(page: Page, nome: string): Promise<void> {
  await page.getByRole('button', { name: nome, exact: true }).click();
}

/** O campo da entrada rápida (paleta, nome de arquivo, escolha de linguagem). */
export function entradaRapida(page: Page): Locator {
  return page.getByRole('dialog').getByRole('textbox');
}

/**
 * Responde ao diálogo de confirmação do projeto.
 *
 * Roda DEPOIS da ação que o abre — é componente da página, não do navegador.
 * Foi o que substituiu `responderDialogo` na spec 007.
 */
export async function confirmar(page: Page, aceitar: boolean): Promise<void> {
  const caixa = page.getByRole('dialog');
  await caixa.getByRole('button', { name: aceitar ? /fechar sem salvar|excluir|confirmar|ok/i : /cancelar/i }).click();
}

/**
 * Deixa o cofre aberto, esteja ele como estiver.
 *
 * A suíte compartilha um servidor, e o cofre é estado global: depender do que o
 * arquivo anterior deixou é receita de falha por ordem de execução.
 */
export async function garantirCofreAberto(page: Page, senha: string): Promise<void> {
  const destrancar = page.getByRole('button', { name: 'Destrancar o cofre' });
  if (await destrancar.isVisible()) {
    await destrancar.click();
    const campo = page.getByLabel('Senha mestra');
    await campo.fill(senha);
    await page.getByRole('button', { name: 'destrancar' }).click();
  }
  await page.getByRole('button', { name: 'Recolher tudo' }).and(page.locator(':not([disabled])')).waitFor();
}

/**
 * Espera o editor estar montado e pronto para receber teclas.
 *
 * O Monaco monta em etapas, e digitar antes de a área de texto existir manda as
 * teclas para lugar nenhum — sem erro, e com o teste falhando por "nada foi
 * digitado". Foi a causa de instabilidade nos testes da spec 010.
 */
export async function esperarEditorPronto(page: Page): Promise<void> {
  await editor(page).locator('.monaco-editor').waitFor();
  await editor(page).locator('textarea').waitFor({ state: 'attached' });
  await editor(page).click();
}

/** Quantos cursores há agora. É como se verifica multi-cursor de fato. */
export function cursores(page: Page): Locator {
  return editor(page).locator('.cursor');
}
