// Painel de conexões: cofre, árvore, grade e menu de contexto.
//
// Estes testes trancam o cofre, que é estado global do servidor — é a razão de
// a suíte rodar com um worker só.
import { expect, test } from '@playwright/test';
import { bancoDeTeste, CONEXAO, SENHA_MESTRA, TABELA } from './global-setup';
import {
  aba, confirmar, destrancarCofre, expandir, linhaArvore, painelLateral, textoDoEditor,
  esperarIdePronta,
} from './fixtures';

/** Deixa o cofre trancado, que é o estado com que a IDE sempre inicia de fato. */
async function trancarCofre(page: import('@playwright/test').Page): Promise<void> {
  const trancar = page.getByRole('button', { name: /Trancar o cofre/ });
  if (await trancar.isVisible()) await trancar.click();
  await expect(page.getByRole('button', { name: 'Destrancar o cofre' })).toBeVisible();
}

/**
 * Restringe à área do formulário.
 *
 * Precisa ser a região do próprio formulário, e não `main`: `main` engloba a
 * lateral, e o rótulo "Arquivos" da aba de painel casa com o campo "Arquivo"
 * do SQLite. Seletor amplo demais é a mesma armadilha do seletor ambíguo.
 */
function formulario(page: import('@playwright/test').Page) {
  return page.getByRole('form', { name: 'Formulário de conexão' });
}

/** Destranca pelo botão da barra — os testes de formulário não passam pela árvore. */
async function destrancarPeloBotao(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Destrancar o cofre' }).click();
  await destrancarCofre(page, SENHA_MESTRA);
  await expect(page.getByRole('button', { name: 'Nova conexão', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
  await painelLateral(page, 'Database').click();
  await expect(linhaArvore(page, 'ACME')).toBeVisible();
  await trancarCofre(page);
});

test('cofre trancado pede a senha ao clicar na conexão e abre a árvore', async ({ page }) => {
  await expect(page.getByText(/Cofre trancado/)).toBeVisible();

  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await destrancarCofre(page, SENHA_MESTRA);

  await expect(linhaArvore(page, 'escola.db')).toBeVisible();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('senha errada mantém o diálogo aberto, com o aviso', async ({ page }) => {
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();

  await destrancarCofre(page, 'senha-que-nao-e-a-certa');
  await expect(page.getByText(/Senha mestra incorreta/i)).toBeVisible();
  // O diálogo continua de pé: errar não pode custar recomeçar do zero.
  await expect(page.getByLabel('Senha mestra', { exact: true })).toBeVisible();

  await destrancarCofre(page, SENHA_MESTRA);
  await expect(linhaArvore(page, 'escola.db')).toBeVisible();
});

test('a caixa de lembrar nasce desmarcada', async ({ page }) => {
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();

  // Lembrar é escolha consciente por sessão, nunca o padrão silencioso.
  await expect(page.getByRole('checkbox', { name: /Lembrar neste computador/ })).not.toBeChecked();
});

test('executar consulta abre a grade com colunas tipadas e as linhas', async ({ page }) => {
  // Fecha a pendência que a spec 001 deixou declarada: a grade nunca tinha sido
  // vista com dados reais.
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, TABELA).dblclick();
  await expect.poll(() => textoDoEditor(page)).toMatch(new RegExp(`SELECT \\* FROM ${TABELA}`));

  // O nome INTEIRO, ancorado. Com `/consulta|arquivo/` solto, este clique caiu
  // no botão "Importar conexões de um arquivo" da lateral assim que ele passou a
  // existir — ele casa com `arquivo` e vem antes no DOM. O teste executava a
  // importação achando que executava a consulta, e falhava na grade ausente,
  // trinta linhas depois do erro de verdade.
  await page.getByRole('button', { name: /^Executar (consulta|arquivo)$/ }).click();

  const grade = page.locator('table');
  await expect(grade).toBeVisible();
  await expect(grade.locator('th')).toContainText(['id', 'nome', 'nota']);
  await expect(grade).toContainText('INTEGER');
  await expect(grade).toContainText('joshua');
  await expect(grade).toContainText('maria');
  // Qualificado pelo nome da aba: a contagem também aparece no painel de saída,
  // e um seletor ambíguo falharia por modo estrito em vez de por regressão.
  //
  // O `· main ·` no meio entrou com a spec 038: o cabeçalho passou a dizer
  // contra qual DATABASE a query rodou. Numa IDE em que a mesma conexão fala
  // com vários bancos, saber de qual vieram as linhas não é enfeite.
  await expect(
    page.getByText(new RegExp(`${TABELA}\\.sql · main · 2 linha\\(s\\)`))
  ).toBeVisible();
});

test('menu do botão direito oferece as ações do nó e abre o DDL', async ({ page }) => {
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await destrancarCofre(page, SENHA_MESTRA);
  await expandir(page, 'escola.db', 'Tables');

  await linhaArvore(page, TABELA).click({ button: 'right' });

  const menu = page.getByRole('menuitem');
  await expect(menu).toContainText(['Copiar nome', 'Abrir Query', 'Ver DDL']);

  await page.getByRole('menuitem', { name: 'Ver DDL' }).click();
  await expect(aba(page, `${TABELA} (DDL)`)).toBeVisible();
  await expect.poll(() => textoDoEditor(page)).toMatch(new RegExp(`CREATE TABLE ${TABELA}`));
});

test('cadastra uma conexão pelo formulário e ela aparece na árvore', async ({ page }) => {
  await destrancarPeloBotao(page);
  await page.getByRole('button', { name: 'Nova conexão', exact: true }).click();

  await expect(aba(page, 'Nova conexão')).toBeVisible();
  await formulario(page).getByLabel('Nome', { exact: true }).fill('biblioteca');
  await formulario(page).getByLabel('Grupo').fill('ACME/Bancos');

  // A grade de tipos sai dos metadados do driver — nenhum nome de campo é fixo
  // na interface.
  await formulario(page).getByRole('button', { name: 'SQLite', exact: true }).click();
  await formulario(page).getByLabel('Arquivo').fill(bancoDeTeste());

  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();

  await expect(aba(page, 'Nova conexão')).toHaveCount(0);
  await expandir(page, 'ACME', 'Bancos');
  await expect(linhaArvore(page, 'biblioteca')).toBeVisible();

  // Desfaz: deixar a conexão criada faz os testes seguintes verem duas onde
  // esperavam uma, e a falha aparece longe da causa.
  const criada = linhaArvore(page, 'biblioteca');
  await criada.hover();
  await criada.getByRole('button', { name: 'Excluir conexão' }).click();
  await confirmar(page, true);
  await expect(linhaArvore(page, 'biblioteca')).toHaveCount(0);
});

test('editar não pede a senha de novo e mantém a conexão funcionando', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');

  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByText('Editar conexão…').click();

  // Nem tipo, nem arquivo: só o rótulo muda. O segredo (quando houver) fica
  // guardado, e é justamente por o campo ir em branco que ele sobrevive.
  await expect(aba(page, CONEXAO)).toBeVisible();
  await formulario(page).getByLabel('Nome', { exact: true }).fill('escola-renomeada');
  await formulario(page).getByRole('button', { name: 'salvar e conectar' }).click();

  await expect(linhaArvore(page, 'escola-renomeada')).toBeVisible();
  // Conectou de fato: a árvore do banco abriu.
  await expect(linhaArvore(page, 'escola.db')).toBeVisible();

  // Desfaz: a suíte roda com um worker só contra UM servidor, então o cofre é
  // estado compartilhado. Um teste que renomeia e não restaura faz o seguinte
  // procurar um nome que não existe mais — e a falha aparece no teste errado.
  await linhaArvore(page, 'escola-renomeada').click({ button: 'right' });
  await page.getByText('Editar conexão…').click();
  await formulario(page).getByLabel('Nome', { exact: true }).fill(CONEXAO);
  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();
});

test('o tipo não pode ser trocado ao editar', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByText('Editar conexão…').click();

  await expect(formulario(page).getByRole('button', { name: 'SQLite', exact: true })).toBeDisabled();
});

test('campo obrigatório vazio é recusado sem ida ao servidor', async ({ page }) => {
  await destrancarPeloBotao(page);
  await page.getByRole('button', { name: 'Nova conexão', exact: true }).click();

  await formulario(page).getByLabel('Nome', { exact: true }).fill('sem-arquivo');
  await formulario(page).getByRole('button', { name: 'SQLite', exact: true }).click();
  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();

  await expect(formulario(page).getByText('Campo obrigatório.')).toBeVisible();
  await expect(aba(page, 'Nova conexão')).toBeVisible();
});

test('o cabeçalho traz as ações como ícone, desabilitadas com o cofre trancado', async ({ page }) => {
  // Trancado: recarregar continua valendo (a árvore renderiza sem senha), mas
  // recolher e adicionar não têm o que fazer.
  await expect(page.getByRole('button', { name: 'Recarregar' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Recolher tudo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Nova conexão', exact: true })).toBeDisabled();

  await destrancarPeloBotao(page);
  await expect(page.getByRole('button', { name: 'Recolher tudo' })).toBeEnabled();
});

test('recolher tudo fecha os grupos abertos', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();

  await page.getByRole('button', { name: 'Recolher tudo' }).click();
  await expect(linhaArvore(page, CONEXAO)).toHaveCount(0);
  await expect(linhaArvore(page, 'ACME')).toBeVisible();
});

test('o "+" da pasta abre o formulário com o grupo já preenchido', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME');

  await linhaArvore(page, 'Bancos').hover();
  await page.getByRole('button', { name: 'Nova conexão em "ACME/Bancos"' }).click();

  await expect(formulario(page).getByLabel('Grupo')).toHaveValue('ACME/Bancos');
});

test('renomear a pasta leva os descendentes junto', async ({ page }) => {
  await destrancarPeloBotao(page);

  await linhaArvore(page, 'ACME').hover();
  await page.getByRole('button', { name: 'Renomear "ACME"' }).click();

  const campo = page.getByRole('dialog').getByRole('textbox');
  await campo.fill('ACME SA');
  await page.keyboard.press('Enter');

  await expect(linhaArvore(page, 'ACME SA')).toBeVisible();
  // O subgrupo acompanhou: a conexão continua alcançável por baixo do novo nome.
  await expandir(page, 'ACME SA', 'Bancos');
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();

  // Desfaz: o cofre é estado compartilhado entre os testes desta suíte.
  await linhaArvore(page, 'ACME SA').hover();
  await page.getByRole('button', { name: 'Renomear "ACME SA"' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('ACME');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, 'ACME')).toBeVisible();
});

test('a linha da conexão oferece recarregar e excluir no hover', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');

  const linha = linhaArvore(page, CONEXAO);
  const acoes = linha.locator('.linha-acoes');

  // `toBeVisible()` NÃO serve aqui: para o Playwright, opacity 0 continua
  // visível. Só medir a opacidade prova que as ações estavam escondidas.
  const opacidade = () => acoes.evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(await opacidade())).toBe(0);

  await linha.hover();
  await expect.poll(async () => Number(await opacidade())).toBe(1);
  await expect(linha.getByRole('button', { name: 'Recarregar metadados' })).toBeVisible();
  await expect(linha.getByRole('button', { name: 'Excluir conexão' })).toBeVisible();
});

test('excluir pela linha pede confirmação e recusar mantém a conexão', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');

  const linha = linhaArvore(page, CONEXAO);
  await linha.hover();
  await linha.getByRole('button', { name: 'Excluir conexão' }).click();

  // Diálogo do projeto, não do navegador — e destrutivo precisa de confirmação.
  await expect(page.getByRole('dialog')).toContainText(CONEXAO);
  await confirmar(page, false);
  await expect(linhaArvore(page, CONEXAO)).toBeVisible();
});

test('a categoria oferece recarregar, filtrar e criar', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await expect(categoria.getByRole('button', { name: /Recarregar Tables/ })).toBeVisible();
  await expect(categoria.getByRole('button', { name: /Filtrar Tables/ })).toBeVisible();
  await expect(categoria.getByRole('button', { name: /Criar em Tables/ })).toBeVisible();
});

test('filtrar reduz a lista e some quando o filtro é apagado', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toBeVisible();

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Filtrar Tables/ }).click();

  await page.getByRole('dialog').getByRole('textbox').fill('zzz-nao-existe');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, TABELA)).toHaveCount(0);

  // O botão fica destacado: filtro invisível faria parecer que a tabela sumiu.
  await categoria.hover();
  await expect(categoria.getByRole('button', { name: /Filtrar Tables/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await categoria.getByRole('button', { name: /Filtrar Tables/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('');
  await page.keyboard.press('Enter');
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('o filtro sobrevive ao F5 (T111)', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toBeVisible();

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Filtrar Tables/ }).click();
  await page.getByRole('dialog').getByLabel('Nome').fill('zzz-nao-existe');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(linhaArvore(page, TABELA)).toHaveCount(0);

  // O F5 é o teste inteiro: antes desta spec o filtro morria com a aba.
  // O cofre NÃO é redestrancado: a chave vive no processo do servidor, e
  // recarregar a página não a apaga.
  await page.reload();
  await esperarIdePronta(page);
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');
  await expect(linhaArvore(page, TABELA)).toHaveCount(0);

  const depois = linhaArvore(page, 'Tables');
  await depois.hover();
  await expect(depois.getByRole('button', { name: /Filtrar Tables/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  // Limpar no fim: o arquivo é compartilhado pelos testes desta suíte, e um
  // filtro esquecido esconderia a tabela do teste seguinte.
  await depois.getByRole('button', { name: /Filtrar Tables/ }).click();
  await page.getByRole('button', { name: 'Limpar' }).click();
  await expect(linhaArvore(page, TABELA)).toBeVisible();
});

test('o SQLite só oferece o filtro por NOME (T112)', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Filtrar Tables/ }).click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByLabel('Nome')).toBeVisible();
  // O SQLite não tem dono, tamanho por objeto nem data: os campos NÃO existem.
  await expect(dialogo.getByLabel('Dono')).toHaveCount(0);
  await expect(dialogo.getByLabel('Maior que')).toHaveCount(0);
  await expect(dialogo.getByLabel('Mexida desde')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

test('criar abre o esqueleto e ABRIR NO EDITOR não executa nada', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Criar em Tables/ }).click();

  // T113: o `+` abre a janela com o esqueleto. O caminho longo continua ali.
  await expect(page.getByRole('dialog')).toContainText('CREATE TABLE nova_tabela');
  await page.getByRole('button', { name: 'Abrir no editor' }).click();

  await expect(aba(page, 'novo_tables.sql')).toBeVisible();
  await expect.poll(() => textoDoEditor(page)).toMatch(/CREATE TABLE nova_tabela/);
  // Nada foi executado: não há grade de resultado.
  await expect(page.getByText(/linha\(s\)/)).toHaveCount(0);
});

test('criar EXECUTA e a tabela nova aparece na árvore (T113)', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Criar em Tables/ }).click();

  // O esqueleto é EDITÁVEL: o nome que ele digitar é o que vai ao banco.
  const campo = page.getByLabel('Comando a executar');
  await campo.fill('CREATE TABLE criada_pela_arvore (id INTEGER PRIMARY KEY);');
  await page.getByRole('button', { name: 'Executar' }).click();

  // Recarrega a categoria sozinha: sem isso o objeto só apareceria no F5.
  await expect(linhaArvore(page, 'criada_pela_arvore')).toBeVisible();

  // Não se limpa aqui de propósito: o `DROP` do menu é GERADO e aberto, não
  // executado (spec 046), e a janela de criar recusa destrutivo. A tabela fica
  // até o fim da execução — o `escola.db` da suíte é recriado a cada rodada.
});

test('o esqueleto com DELIMITER não oferece Executar, e diz por quê', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db');

  const categoria = linhaArvore(page, 'Tables');
  await categoria.hover();
  await categoria.getByRole('button', { name: /Criar em Tables/ }).click();

  // `DELIMITER` é comando do cliente mysql, não do servidor: mandá-lo pela
  // conexão dá erro de sintaxe. O botão fica desligado ANTES do clique.
  await page.getByLabel('Comando a executar').fill('DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$');
  await expect(page.getByRole('button', { name: 'Executar' })).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('DELIMITER');

  // E o que APAGA também não sai daqui: a janela cria, e a regra da spec 046
  // manda o destrutivo pelo editor, sob o ▷ Run.
  await page.getByLabel('Comando a executar').fill('DROP TABLE escola;');
  await expect(page.getByRole('button', { name: 'Executar' })).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('DROP');
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

test('o diagrama ER abre como markdown JÁ renderizado (T064)', async ({ page }) => {
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();

  // O diagrama é do SCHEMA — no SQLite, o arquivo inteiro.
  await linhaArvore(page, 'escola.db').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Diagrama ER' }).click();

  // Abre em PREVIEW: o desenho, e não o texto do Mermaid. O switch da spec 068
  // continua ali para quem quiser a fonte.
  await expect(aba(page, 'escola.db.er.md')).toBeVisible();
  await expect(page.locator('[data-markdown-preview] svg').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('radio', { name: 'Preview' })).toBeChecked();

  // O diagrama abre numa JANELA com zoom e arrasto. Sem isso ele virava uma
  // fileira de tarjas ilegíveis — foi a reclamação dele, com print:
  // "como que eu iria dar zoom na tela para enxergar isso?!".
  const janela = page.locator('[data-janela-do-diagrama]');
  await expect(janela).toBeVisible();
  await expect(janela.getByRole('button', { name: 'Aproximar o diagrama' })).toBeVisible();
  await expect(janela.getByRole('button', { name: 'Tamanho real do diagrama' })).toBeVisible();
  await expect(janela.getByRole('button', { name: 'Enquadrar o diagrama inteiro' })).toBeVisible();

  // E abre em TAMANHO DE LEITURA, não enquadrado: enquadrar um diagrama largo
  // dá 2% de escala, que é o mesmo que não desenhar.
  const antes = await janela.locator('svg').boundingBox();
  await janela.getByRole('button', { name: 'Aproximar o diagrama' }).click();
  const depois = await janela.locator('svg').boundingBox();
  expect((depois?.width ?? 0)).toBeGreaterThan(antes?.width ?? 0);
});

test('o botão do diagrama NÃO aparece numa tabela (T064)', async ({ page }) => {
  // A primeira condição adivinhava pela forma do `meta`, e a tabela também tem
  // `meta.schema`: o item nascia em toda linha. Agora quem declara é o NÓ.
  await destrancarPeloBotao(page);
  await expandir(page, 'ACME', 'Bancos');
  await linhaArvore(page, CONEXAO).click();
  await expandir(page, 'escola.db', 'Tables');

  const tabela = linhaArvore(page, TABELA);
  await tabela.hover();
  await expect(tabela.getByRole('button', { name: /Diagrama ER/ })).toHaveCount(0);

  await tabela.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Diagrama ER' })).toHaveCount(0);
});
