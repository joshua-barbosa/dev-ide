// A árvore remota por SSH (spec 052).
//
// Contra um `sshd` de verdade, descartável, subido pela própria suíte — ver
// `sshd-de-teste.ts`. Nada aqui toca servidor do usuário.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO_SSH } from './global-setup';
import { destrancarCofre, esperarIdePronta, expandir, linhaArvore, painelLateral } from './fixtures';
import { SENHA_MESTRA } from './global-setup';

async function abrirServidor(page: Page): Promise<void> {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  await linhaArvore(page, CONEXAO_SSH).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  // A raiz do servidor de teste tem estas duas pastas.
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a conexão SSH aparece no painel Service, e NÃO no Database', async ({ page }) => {
  await painelLateral(page, 'Database').click();
  await expect(linhaArvore(page, CONEXAO_SSH)).toHaveCount(0);

  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  await expect(linhaArvore(page, CONEXAO_SSH)).toBeVisible();
});

test('conectar abre a árvore do servidor, com pastas antes dos arquivos', async ({ page }) => {
  await abrirServidor(page);

  // A ordem importa: pastas primeiro, e o resto em ordem de gente.
  const rotulos = await page.locator('[data-tree-row]').allTextContents();
  const iAplicacao = rotulos.findIndex((t) => t.includes('aplicacao'));
  const iLogs = rotulos.findIndex((t) => t.includes('logs'));
  const iNotas = rotulos.findIndex((t) => t.includes('notas.txt'));
  expect(iAplicacao).toBeLessThan(iLogs);
  expect(iLogs).toBeLessThan(iNotas);
});

test('os dois atalhos vêm no topo, e o Users lista gente', async ({ page }) => {
  await abrirServidor(page);
  await expect(linhaArvore(page, 'Users')).toBeVisible();
  await expect(linhaArvore(page, 'Favorites')).toBeVisible();

  await linhaArvore(page, 'Users').click();
  // Quem roda o `sshd` de teste é o próprio usuário da máquina, então ele está
  // na lista — qualquer que seja o nome dele.
  await expect(page.locator('[data-tree-row]').filter({ hasText: '/home/' }).first())
    .toBeVisible({ timeout: 15_000 });
});

test('o arquivo mostra o TAMANHO ao lado do nome', async ({ page }) => {
  await abrirServidor(page);
  // `notas.txt` tem 2048 bytes no servidor de teste.
  await expect(linhaArvore(page, 'notas.txt')).toContainText('2K');
  // Pasta não mostra tamanho: o do diretório se confundiria com o do conteúdo.
  await expect(linhaArvore(page, 'logs')).not.toContainText('B');
});

test('o tooltip traz modificação, permissão e dono', async ({ page }) => {
  await abrirServidor(page);
  const titulo = await linhaArvore(page, 'run.sh').getAttribute('title');
  expect(titulo ?? '').toContain('Modificado:');
  expect(titulo ?? '').toContain('Permissão: 0755');
  expect(titulo ?? '').toContain('Dono:');
  // NÃO diz "criado": o SFTP não carrega essa data, e a ferramenta de
  // referência rotula errado o valor de acesso.
  expect(titulo ?? '').not.toContain('Criado');
});

test('a distribuição do servidor aparece ao lado do nome da conexão', async ({ page }) => {
  await abrirServidor(page);
  // Qualquer distro serve — o que se prova é que a IDE foi perguntar.
  await expect(linhaArvore(page, CONEXAO_SSH)).not.toHaveText(CONEXAO_SSH, { timeout: 15_000 });
});

test('entrar numa pasta lista o que há dentro dela', async ({ page }) => {
  await abrirServidor(page);
  await linhaArvore(page, 'aplicacao').click();
  await expect(linhaArvore(page, 'src')).toBeVisible();
  await expect(linhaArvore(page, 'README.md')).toBeVisible();

  await linhaArvore(page, 'src').click();
  await expect(linhaArvore(page, 'main.ts')).toBeVisible();
});

test('o arquivo oculto aparece — a conexão nasce mostrando ocultos', async ({ page }) => {
  // Quem abre um servidor por SSH costuma estar atrás de `.env`.
  await abrirServidor(page);
  await expect(linhaArvore(page, '.env')).toBeVisible();
});

test('o formulário do SSH mostra só os campos do Auth escolhido', async ({ page }) => {
  await painelLateral(page, 'Service').click();
  await page.getByRole('button', { name: /Nova conexão/ }).first().click();
  await page.getByRole('button', { name: 'SSH', exact: true }).click();

  // Senha é o padrão: senha à vista, chave escondida.
  await expect(page.getByLabel('Senha', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Passphrase da chave')).toHaveCount(0);

  // `getByRole('combobox')`: o `select` do MUI rende dois elementos com o mesmo
  // rótulo — o visível e um `input` escondido que carrega o valor.
  const auth = page.getByRole('combobox', { name: 'Autenticação' });
  await auth.click();
  await page.getByRole('option', { name: 'Chave privada' }).click();
  await expect(page.getByLabel('Passphrase da chave')).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);

  await auth.click();
  await page.getByRole('option', { name: 'Agente' }).click();
  await expect(page.getByLabel('Socket do agente')).toBeVisible();
  await expect(page.getByLabel('Passphrase da chave')).toHaveCount(0);
});

test('os três campos de algoritmo existem, vazios, fora da seção principal', async ({ page }) => {
  await painelLateral(page, 'Service').click();
  await page.getByRole('button', { name: /Nova conexão/ }).first().click();
  await page.getByRole('button', { name: 'SSH', exact: true }).click();

  // Recolhida: quem não precisa nunca a vê. Está no DOM — o acordeão do MUI
  // não desmonta o conteúdo —, e o que importa é que não está à vista.
  await expect(page.getByLabel('Ciphers')).not.toBeVisible();
  await page.getByRole('button', { name: /Algoritmo/ }).click();
  for (const rotulo of ['Ciphers', 'Troca de chaves (kex)', 'Chave do servidor']) {
    await expect(page.getByLabel(rotulo)).toHaveValue('');
  }
});

// ---------------------------------------------------------------------------
// O terminal SSH (spec 054)
// ---------------------------------------------------------------------------

test('a conexão SSH oferece terminal, e ele roda NO SERVIDOR', async ({ page }) => {
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  const linha = linhaArvore(page, CONEXAO_SSH);
  await linha.click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'aplicacao')).toBeVisible({ timeout: 30_000 });

  await linha.hover();
  await linha.getByRole('button', { name: /terminal/i }).click();

  const terminal = page.locator('[data-terminal]').first();
  await expect(terminal).toBeVisible();
  // O prompt do servidor — o canal SSH está de pé.
  await expect(terminal).toContainText(/\$|%|#/, { timeout: 30_000 });

  await terminal.click();
  // `uname` prova que rodou do outro lado. O `sshd` de teste é local, então o
  // que se afirma é o caminho: tecla → WebSocket → canal `ssh2` → shell remoto.
  await page.keyboard.type('echo VEIO-DO-CANAL-SSH');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('VEIO-DO-CANAL-SSH', { timeout: 30_000 });
});

test('o terminal SSH não usa cliente de linha de comando — não há senha em argv', async ({ page }) => {
  // A conexão do teste autentica por CHAVE, mas o ponto vale para senha: o
  // canal sai da conexão que já está aberta, e nada vai para linha de comando.
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  await linhaArvore(page, CONEXAO_SSH).hover();
  await expect(
    linhaArvore(page, CONEXAO_SSH).getByRole('button', { name: /terminal/i })
  ).toBeVisible();
});

test('clicar num ATALHO não abre query — ele não é objeto de banco', async ({ page }) => {
  // `Favorites` vazio chegou a abrir `SELECT * FROM Favorites LIMIT 100`: sem
  // filhos, o clique caía no caminho de folha, que é o do banco. Visto no
  // navegador (spec 055).
  await painelLateral(page, 'Service').click();
  await expandir(page, 'ACME', 'Servidores');
  await linhaArvore(page, CONEXAO_SSH).click();
  const senha = page.getByLabel('Senha mestra');
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'Favorites')).toBeVisible({ timeout: 30_000 });

  await linhaArvore(page, 'Favorites').click();
  await expect(page.locator('[data-tab="Favorites.sql"]')).toHaveCount(0);
  // Ele ABRE, e mostra que está vazio — em vez de não responder.
  await expect(page.getByText('(vazio)')).toBeVisible();
});
