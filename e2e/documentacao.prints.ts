// Gera os prints da documentação. Não é teste: não afirma nada.
//
// Cada bloco monta uma tela e salva a imagem em `docs/imagens/`. Quando a
// interface mudar, `npm run prints` refaz todas — é isso que impede a
// documentação de envelhecer sem ninguém perceber.
import { test, type Page } from '@playwright/test';
import * as path from 'node:path';
import {
  abrirArquivo, esperarIdePronta, expandir, garantirCofreAberto, linhaArvore, painelLateral,
} from './fixtures';

const PASTA = path.join(process.cwd(), 'docs', 'imagens');
const SENHA = 'senha-de-teste';
const CONEXAO = 'escola';

/**
 * Congela o que se mexe antes de fotografar.
 *
 * Sem isto, o cursor do editor pisca e a metade dos prints sai com ele apagado
 * — o que faz a documentação parecer inconsistente sem motivo.
 */
async function congelar(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
      }
      .monaco-editor .cursor { visibility: hidden !important; }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function foto(page: Page, nome: string): Promise<void> {
  await congelar(page);
  await page.screenshot({ path: path.join(PASTA, `${nome}.png`) });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('01 — a tela inteira, com um arquivo aberto', async ({ page }) => {
  // Um arquivo com corpo de verdade: o `utils.ts` do projeto de teste tem três
  // linhas, e um print de editor quase vazio não mostra nada do editor.
  await page.evaluate(async () => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${pasta}/matricula.ts`,
        content: [
          "import { conectar } from './banco';",
          '',
          'export interface Aluno {',
          '  readonly id: number;',
          '  readonly nome: string;',
          '  readonly nota: number;',
          '}',
          '',
          '/** Os aprovados, do melhor para o pior. */',
          'export async function aprovados(minima = 7): Promise<Aluno[]> {',
          '  const banco = await conectar();',
          '  const linhas = await banco.consultar<Aluno>(',
          "    'SELECT id, nome, nota FROM alunos WHERE nota >= ? ORDER BY nota DESC',",
          '    [minima]',
          '  );',
          '',
          '  if (linhas.length === 0) {',
          "    console.warn('Nenhum aluno acima de', minima);",
          '  }',
          '  return linhas;',
          '}',
          '',
          'export const MEDIA_MINIMA = 7;',
          '',
        ].join('\n'),
      }),
    });
  });
  await abrirArquivo(page, 'matricula.ts');
  await foto(page, '01-visao-geral');
});

test('02 — a árvore de arquivos e a busca', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  await painelLateral(page, 'Search').click();
  await page.getByLabel('Pesquisar', { exact: true }).fill('ola');
  await page.waitForTimeout(1200);
  await foto(page, '02-busca');
});

test('03 — a árvore de conexões, com o banco aberto', async ({ page }) => {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await garantirCofreAberto(page, SENHA);
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');
  await page.waitForTimeout(800);
  await foto(page, '03-conexoes');
});

test('04 — a grade de resultado de uma consulta', async ({ page }) => {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await garantirCofreAberto(page, SENHA);
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');
  await linhaArvore(page, 'alunos').dblclick();
  await page.getByRole('button', { name: /^Executar (consulta|arquivo)$/ }).click();
  await page.locator('table').waitFor({ timeout: 20_000 });
  await foto(page, '04-grade');
});

test('05 — o preview de markdown, com diagrama', async ({ page }) => {
  await page.evaluate(async () => {
    const w = await fetch('/api/workspace');
    const { pasta } = (await w.json()).data as { pasta: string };
    await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${pasta}/exemplo-doc.md`,
        content: [
          '# Fluxo de matrícula',
          '',
          'A área do gráfico é $x^2$.',
          '',
          '```mermaid',
          'graph TD',
          '  A[Inscrição] --> B[Análise]',
          '  B --> C[Matrícula]',
          '```',
          '',
        ].join('\n'),
      }),
    });
  });
  await abrirArquivo(page, 'exemplo-doc.md');
  await page.locator('[data-barra-do-arquivo]').getByRole('radio', { name: 'Preview' }).click();
  await page.locator('[data-markdown-preview] .mermaid-por-desenhar svg').waitFor({
    timeout: 20_000,
  });
  await foto(page, '05-preview');
});

test('06 — o terminal no painel inferior', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  const painel = page.locator('[data-painel-inferior]');
  if (!(await painel.isVisible())) await page.keyboard.press('Control+j');
  await page.locator('[data-aba-painel="terminal"]').click();
  await page.waitForTimeout(2500);
  await foto(page, '06-terminal');
});
