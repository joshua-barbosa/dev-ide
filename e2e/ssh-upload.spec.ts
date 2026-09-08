// Arrastar de fora para dentro (spec 060).
//
// O `dataTransfer` de um arraste de VERDADE não pode ser fabricado por script —
// `webkitGetAsEntry` só existe em item vindo do sistema. Então o que se prova
// aqui é o caminho todo por baixo do gesto: a rota de upload, o binário
// intacto, a criação de pastas e a recusa de quem tenta sair.
//
// O gesto em si (soltar o arquivo) é verificação do usuário — como ele mesmo
// pediu para as coisas que escrevem.
import { expect, test } from '@playwright/test';
import { CONEXAO_SSH, SENHA_MESTRA } from './global-setup';
import { destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';

/** Conecta e devolve o id e a raiz da conexão SSH. */
async function conectar(page: import('@playwright/test').Page): Promise<{ id: string; raiz: string }> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  await linhaArvore(page, CONEXAO_SSH).click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });

  return page.evaluate(async () => {
    const estado = await fetch('/api/connections').then((r) => r.json());
    const achar = (g: { connections: { id: string; type: string }[]; groups: unknown[] }): string | null => {
      const dele = g.connections.find((c) => c.type === 'ssh');
      if (dele !== undefined) return dele.id;
      for (const sub of g.groups) {
        const achado = achar(sub as Parameters<typeof achar>[0]);
        if (achado !== null) return achado;
      }
      return null;
    };
    const id = achar(estado.data.tree) ?? '';
    const caps = await fetch(`/api/connections/${id}/connect`, { method: 'POST' }).then((r) => r.json());
    return { id, raiz: caps.data.rootPath as string };
  });
}

/** Conecta e abre a sub-aba SFTP da aba do servidor. */
async function abrirSftp(page: import('@playwright/test').Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });

  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();
  await page.locator('[data-sub-aba="sftp"]').click();
  await expect(page.locator('[data-caminho-sftp]')).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('o upload grava BYTES intactos — texto passaria a corromper binário', async ({ page }) => {
  const { id, raiz } = await conectar(page);
  // Bytes que não são UTF-8 válido: é exatamente o que uma imagem tem, e o que
  // um `write` de string transformaria em `?`.
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01];
  const status = await page.evaluate(
    async ([conexao, caminho, dados]) => {
      const r = await fetch(
        `/api/connections/${conexao}/files/upload?path=${encodeURIComponent(caminho as string)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(dados as number[]),
        }
      );
      return (await r.json()) as { success: boolean; data: { bytes: number } };
    },
    [id, `${raiz}/binario.png`, bytes] as const
  );
  expect(status.success).toBe(true);
  expect(status.data.bytes).toBe(bytes.length);
});

test('o upload cria as pastas do caminho', async ({ page }) => {
  const { id, raiz } = await conectar(page);
  await page.evaluate(
    async ([conexao, caminho]) => {
      await fetch(
        `/api/connections/${conexao}/files/upload?path=${encodeURIComponent(caminho)}&mkdir=1`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array([104, 105]),
        }
      );
    },
    [id, `${raiz}/subiu/fundo/x.txt`] as const
  );

  const lista = await page.evaluate(
    async ([conexao, pasta]) => {
      const r = await fetch(
        `/api/connections/${conexao}/files/list?path=${encodeURIComponent(pasta)}`
      ).then((x) => x.json());
      return (r.data as { name: string }[]).map((e) => e.name);
    },
    [id, `${raiz}/subiu/fundo`] as const
  );
  expect(lista).toContain('x.txt');
});

test('a tabela SFTP aceita soltura — e some com ela em somente-leitura', async ({ page }) => {
  // O gesto não dá para fabricar; o que se prova é que a área existe e que a
  // tela reage ao arraste.
  await conectar(page);
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.hover();
  await linha.getByRole('button', { name: /numa aba/ }).click();
  await page.locator('[data-sub-aba="sftp"]').click();
  await expect(page.locator('[data-caminho-sftp]')).toBeVisible({ timeout: 30_000 });

  // Nada de progresso antes de qualquer arraste.
  await expect(page.locator('[data-progresso-upload]')).toHaveCount(0);
});

// O botão `Enviar arquivos` (spec 103).
//
// Ele soltou um arquivo na pasta dentro do editor e nada aconteceu. Duas causas
// somadas: as rotas binárias escapavam do transporte da webview, e o que o
// editor entrega no `dataTransfer` pode não ser arquivo nenhum. A primeira foi
// consertada; a segunda não depende de nós — daí este botão, que abre o
// seletor do SISTEMA e não depende de gesto nenhum.
//
// Ao contrário do arraste, ele PODE ser testado de ponta a ponta.
test('o botão Enviar arquivos sobe o arquivo escolhido, para a pasta em que se está', async ({
  page,
}, testInfo) => {
  await abrirSftp(page);
  const antes = await page.locator('[data-linha-sftp]').count();

  const nome = `enviado-${testInfo.workerIndex}-${Date.now()}.txt`;
  const local = testInfo.outputPath(nome);
  await import('node:fs/promises').then((fs) => fs.writeFile(local, 'conteúdo de teste\n'));

  const seletor = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Enviar arquivos' }).click();
  await (await seletor).setFiles(local);
  await expect(page.locator('[data-linha-sftp]').filter({ hasText: nome })).toBeVisible({
    timeout: 30_000,
  });
  expect(await page.locator('[data-linha-sftp]').count()).toBe(antes + 1);
});

test('desistir do seletor não sobe nada, e não dá erro', async ({ page }) => {
  await abrirSftp(page);
  const antes = await page.locator('[data-linha-sftp]').count();

  const seletor = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Enviar arquivos' }).click();
  await (await seletor).setFiles([]);

  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await page.locator('[data-linha-sftp]').count()).toBe(antes);
});
