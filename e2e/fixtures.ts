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

export const editor = (page: Page): Locator => page.locator('textarea');

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

/** Digita no editor sem salvar, deixando a aba suja. */
export async function digitar(page: Page, texto: string): Promise<void> {
  await editor(page).click();
  await editor(page).press('End');
  await editor(page).pressSequentially(texto);
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
