// Parar uma consulta em andamento (T005 · spec 013).
//
// Eu tinha escrito na spec 013 que isto "entra junto do grid utilizável". O grid
// veio na 041; isto não veio. Ele resgatou da lista dos 114.
//
// O que dá para provar aqui: que a IDE **não oferece** o botão onde o banco não
// sabe cancelar. O alvo de teste é SQLite, e `node:sqlite` é síncrono — enquanto
// a consulta roda, o processo inteiro está parado nela, e não existe segundo
// instante para mandar um `KILL`. Oferecer o botão ali seria prometer o que não
// se cumpre, que é a coisa que esta IDE mais evita.
//
// O caminho de MySQL e Postgres é conferido em `cancelar.test.ts` (o comando) e
// contra os servidores reais dele, à mão.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import { aba, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

async function abrirTabela(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db');
  await linhaArvore(page, 'Tables').click({ position: { x: 24, y: 8 } });
  await linhaArvore(page, TABELA).hover();
  await page.getByRole('button', { name: `Abrir tabela ${TABELA}`, exact: true }).click();
  await expect(aba(page, TABELA)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('no SQLite o botão de parar NÃO aparece, porque ele não sabe parar', async ({ page }) => {
  await abrirTabela(page);
  await expect(page.getByRole('button', { name: 'Parar esta consulta' })).toHaveCount(0);
});

test('a conexão declara que não cancela, e a interface obedece', async ({ page }) => {
  await abrirTabela(page);
  // A prova do Artigo III: a interface não tem `if` para SQLite. Ela pergunta
  // à sessão o que ela sabe fazer, e desenha só isso — a mesma mecânica que fez
  // a aba de FTP nascer sem terminal, na spec 057.
  const capacidades = await page.evaluate(async () => {
    // A resposta é uma ÁRVORE de grupos, e não uma lista — achatar aqui é mais
    // honesto que fingir que `data` é um vetor.
    type No = { connections?: { id: string; label: string }[]; groups?: No[] };
    const achatar = (no: No): { id: string; label: string }[] => [
      ...(no.connections ?? []),
      ...(no.groups ?? []).flatMap(achatar),
    ];
    const r = await fetch('/api/connections', { headers: { accept: 'application/json' } });
    const corpo = (await r.json()) as { data: { tree: No } };
    const alvo = achatar(corpo.data.tree).find((c) => c.label.includes('escola'));
    if (alvo === undefined) return null;
    // `connect` é onde a sessão DECLARA o que sabe fazer — o mesmo objeto que
    // liga as sub-abas de servidor desde a spec 055.
    const c = await fetch(`/api/connections/${alvo.id}/connect`, { method: 'POST' });
    return (await c.json()) as { data: { cancelaQuery: boolean } };
  });
  expect(capacidades?.data.cancelaQuery).toBe(false);
});

test('pedir para cancelar num banco que não cancela responde com o motivo', async ({ page }) => {
  await abrirTabela(page);
  const resposta = await page.evaluate(async () => {
    type No = { connections?: { id: string; label: string }[]; groups?: No[] };
    const achatar = (no: No): { id: string; label: string }[] => [
      ...(no.connections ?? []),
      ...(no.groups ?? []).flatMap(achatar),
    ];
    const r = await fetch('/api/connections', { headers: { accept: 'application/json' } });
    const corpo = (await r.json()) as { data: { tree: No } };
    const alvo = achatar(corpo.data.tree).find((c) => c.label.includes('escola'));
    if (alvo === undefined) return null;
    const c = await fetch(`/api/connections/${alvo.id}/cancel`, { method: 'POST' });
    return (await c.json()) as { error?: string };
  });
  // Texto, e não silêncio: "não respondeu" é a pior interface possível.
  expect(resposta?.error).toContain('não sabe interromper');
});
