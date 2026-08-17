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
