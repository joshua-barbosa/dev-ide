// Parar a execução (spec 013).
//
// A afirmação central: um laço infinito para no clique, e não em 15 segundos.
// O teste PRECISA de um laço de verdade — com um script curto, `Stop` chegaria
// depois do fim e o teste passaria sem provar nada.
import { expect, test } from '@playwright/test';
import {
  esperarEditorPronto, esperarIdePronta, expandir, garantirCofreAberto, linhaArvore, menu,
  painelLateral, saida, statusDaExecucao,
} from './fixtures';
import { SENHA_MESTRA } from './global-setup';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('Stop fica cinza quando não há nada rodando', async ({ page }) => {
  await menu(page, 'Run');
  await expect(page.getByRole('menuitem', { name: 'Stop' })).toBeDisabled();
});

test('um laço infinito é interrompido pelo Stop, com o parcial na tela', async ({ page }) => {
  await menu(page, 'File');
  await page.getByRole('menuitem', { name: 'New Text File' }).click();
  await esperarEditorPronto(page);
  // Escreve antes de travar: é o parcial que precisa sobreviver ao cancelamento.
  await page.keyboard.insertText(
    'console.log("comecei-o-laco"); while (true) { Math.sqrt(2); }'
  );

  await menu(page, 'Run');
  await page.getByRole('menuitem', { name: 'Run File' }).click();
  await expect(statusDaExecucao(page)).toContainText('executando');

  // Só agora o Stop existe de verdade.
  await menu(page, 'Run');
  const parar = page.getByRole('menuitem', { name: 'Stop' });
  await expect(parar).toBeEnabled();
  await parar.click();

  // "cancelado", e não "tempo esgotado": são desfechos diferentes, e o limite
  // de 15 s nem chegou perto.
  await expect(statusDaExecucao(page)).toContainText('cancelado', { timeout: 10_000 });
  await expect(saida(page)).toContainText('comecei-o-laco');
});

test('o Parar NÃO aparece onde o serviço não sabe cancelar (03/09/2026)', async ({ page }) => {
  // Ele: "o botão Parar de uma execução não está funcionando, eu cliquei várias
  // vezes e está travada ali na tela".
  //
  // A capacidade `cancelaQuery` JÁ existia e a interface não a usava: o botão
  // aparecia em toda grade, e só MySQL e PostgreSQL sabiam cancelar. No SQLite
  // — que é o do projeto de teste — o clique não fazia nada.
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, 'escola').click();
  await garantirCofreAberto(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');
  await linhaArvore(page, 'alunos').dblclick();
  await page.getByRole('button', { name: /^Executar (consulta|arquivo)$/ }).click();
  await expect(page.locator('table')).toBeVisible({ timeout: 20_000 });

  // O SQLite não sabe interromper — então o botão não existe.
  await expect(page.getByRole('button', { name: 'Parar esta consulta' })).toHaveCount(0);
});
