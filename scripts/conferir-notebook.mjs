// O notebook `.brnb` usado de verdade, na IDE (spec 112, etapa 1).
//
// O gesto dele do começo ao fim: criar o arquivo, escolher o kernel, escolher a
// conexão, escrever uma célula SQL, rodar, escrever Markdown, salvar, reabrir e
// ver a saída GUARDADA sem rodar de novo, e limpar as saídas. Na etapa 2: o
// kernel Python vivo — rodar, usar o resultado do SQL, Parar e Reiniciar.
//
// Motor de verdade, SQLite descartável, a IDE no Chrome.
//
//   npm run build && npm run conferir:notebook
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(import.meta.dirname, '..');
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const PORTA = 4503;
const BASE = `http://127.0.0.1:${PORTA}`;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-notebook-'));
const pasta = path.join(casa, 'projeto');
mkdirSync(pasta);

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

const banco = path.join(casa, 'exemplo.db');
const db = new DatabaseSync(banco);
db.exec("CREATE TABLE provas (id INTEGER PRIMARY KEY, titulo TEXT); INSERT INTO provas (titulo) VALUES ('primeira'), ('segunda');");
db.close();
// Como a árvore cria: um arquivo VAZIO.
const arquivo = path.join(pasta, 'analise.brnb');
writeFileSync(arquivo, '');

const motor = spawn(process.execPath, [MOTOR], {
  stdio: 'ignore',
  env: {
    ...process.env, PORT: String(PORTA), HOME: casa,
    DEV_IDE_HOME: path.join(casa, 'casa'),
    DEV_IDE_VAULT: path.join(casa, 'vault.json'),
    DEV_IDE_SESSION: path.join(casa, 'sessao.json'),
  },
});
const api = async (rota, corpo) =>
  (await fetch(`${BASE}${rota}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    ...(corpo === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
  }).then((r) => r.json())).data;

let navegador;
try {
  let de_pe = false;
  for (let i = 0; i < 100 && !de_pe; i++) {
    try { await api('/api/connections/drivers'); de_pe = true; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!de_pe) throw new Error('o motor não subiu');
  await api('/api/connections/vault', {});
  const conexao = await api('/api/connections', {
    type: 'sqlite', label: 'exemplo', group: 'Exemplos', readOnly: false, fields: { file: banco },
  });

  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const pagina = await (await navegador.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));
  const url = `${BASE}/?abrirPasta=${encodeURIComponent(pasta)}&abrirArquivo=${encodeURIComponent(arquivo)}`;
  await pagina.goto(url);

  // ---- arquivo vazio: pergunta o kernel ----
  const escolha = pagina.locator('[data-notebook-escolher-kernel]');
  const perguntou = await escolha.waitFor({ timeout: 30000 }).then(() => true, () => false);
  marcar('arquivo .brnb vazio abre PERGUNTANDO o kernel', perguntou);
  await escolha.getByRole('button', { name: 'Python' }).click();
  const nb = pagina.locator('[data-notebook]');
  await nb.waitFor({ timeout: 10000 });
  marcar('escolhido Python, o notebook nasce com o kernel Python',
    (await nb.locator('[data-kernel]').getAttribute('data-kernel')) === 'python');

  // ---- a conexão do notebook ----
  await nb.getByRole('button', { name: 'Conexão do notebook' }).click();
  const seletor = pagina.getByRole('dialog').last();
  await seletor.waitFor({ timeout: 5000 });
  await pagina.keyboard.press('Enter');
  await pagina.waitForTimeout(500);
  const rotulo = await nb.getByRole('button', { name: 'Conexão do notebook' }).innerText();
  marcar('a conexão escolhida aparece na barra', /exemplo/.test(rotulo), JSON.stringify(rotulo));

  // ---- uma célula SQL, rodada ----
  await nb.locator('[data-adicionar="1"]').getByRole('button', { name: 'SQL' }).click();
  const sql = nb.locator('[data-tipo="sql"]').first();
  await sql.waitFor();
  await sql.locator('textarea').first().click();
  await pagina.locator('[data-tipo="sql"] .monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.keyboard.type('SELECT titulo FROM provas ORDER BY id');
  await sql.getByRole('button', { name: /Rodar célula/ }).click();
  const tabela = sql.locator('[data-saida="tabela"]');
  const veio = await tabela.waitFor({ timeout: 10000 }).then(() => true, () => false);
  const textoDaTabela = veio ? await tabela.innerText() : '';
  marcar('rodar a célula SQL mostra a tabela EMBAIXO dela',
    veio && textoDaTabela.includes('primeira') && textoDaTabela.includes('segunda'));
  marcar('a célula ganha o contador [1]', /\[1\]/.test(await sql.innerText()));

  // ---- erro de SQL aparece na célula ----
  await nb.locator('[data-adicionar="2"]').getByRole('button', { name: 'SQL' }).click();
  const ruim = nb.locator('[data-tipo="sql"]').nth(1);
  await ruim.locator('textarea').first().click();
  await pagina.locator('[data-tipo="sql"]').nth(1).locator('.monaco-editor').waitFor({ timeout: 15000 });
  await pagina.keyboard.type('SELECT * FROM tabela_que_nao_existe');
  await ruim.getByRole('button', { name: /Rodar célula/ }).click();
  const erro = ruim.locator('[data-saida="erro"]');
  const deuErro = await erro.waitFor({ timeout: 10000 }).then(() => true, () => false);
  marcar('erro do banco aparece embaixo da célula que falhou',
    deuErro && /tabela_que_nao_existe/.test(await erro.innerText()));

  // ---- Markdown renderizado ----
  await nb.locator('[data-adicionar="3"]').getByRole('button', { name: 'Markdown' }).click();
  const md = nb.locator('[data-tipo="markdown"]').first();
  await md.locator('textarea').first().click();
  await pagina.keyboard.type('# Conclusão da análise');
  await pagina.keyboard.press('Control+Enter');
  const h1 = md.locator('[data-markdown-renderizado] h1');
  marcar('Markdown aparece renderizado',
    await h1.waitFor({ timeout: 5000 }).then(() => true, () => false));

  // ---- etapa 2: o kernel Python vivo ----
  /** Escreve numa célula de código (Monaco) e a roda pelo ▷. */
  const escreverERodar = async (celula, codigo) => {
    await celula.locator('textarea').first().click();
    await celula.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
    await pagina.keyboard.press('Control+A');
    await pagina.keyboard.type(codigo);
    await celula.getByRole('button', { name: /Rodar célula/ }).click();
  };
  /** Espera a célula terminar (o `[*]` some) e devolve o texto das saídas. */
  const saidaDe = async (celula, prazo = 20000) => {
    const inicio = Date.now();
    while (/\[\*\]/.test(await celula.innerText()) && Date.now() - inicio < prazo) {
      await pagina.waitForTimeout(100);
    }
    return celula.locator('[data-saidas]').innerText().catch(() => '');
  };

  const primeira = nb.locator('[data-celula]').first();
  await escreverERodar(primeira, 'print("olá do kernel")\n2 + 3');
  const saidaPy = await saidaDe(primeira);
  marcar('a célula Python roda: print e a última expressão aparecem',
    saidaPy.includes('olá do kernel') && /\b5\b/.test(saidaPy), JSON.stringify(saidaPy.slice(0, 80)));
  const estado = await nb.getByRole('button', { name: 'Interpretador do kernel' }).innerText();
  marcar('a barra mostra o kernel de pé, com a versão do Python', /\d+\.\d+/.test(estado), JSON.stringify(estado));

  // A célula SQL de antes roda de novo, agora COM kernel: vira variável.
  await sql.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaSql = await saidaDe(sql);
  marcar('a célula SQL anuncia a variável que criou', /→ resultado1:.*2 linha/.test(saidaSql),
    JSON.stringify((saidaSql.match(/→[^\n]*/) ?? [''])[0]));

  const n = await nb.locator('[data-celula]').count();
  await nb.locator(`[data-adicionar="${n}"]`).getByRole('button', { name: 'Python' }).click();
  const usa = nb.locator('[data-celula]').nth(n);
  await escreverERodar(usa,
    'nomes = list(resultado1["titulo"]) if hasattr(resultado1, "columns") else [r["titulo"] for r in resultado1]\nnomes');
  const saidaUsa = await saidaDe(usa);
  marcar('a célula Python USA o resultado do SQL de cima', saidaUsa.includes("['primeira', 'segunda']"),
    JSON.stringify(saidaUsa.slice(0, 80)));

  // ---- etapa 4: a variável do kernel volta ao SQL como {{nome}} ----
  await nb.locator(`[data-adicionar="${n + 1}"]`).getByRole('button', { name: 'SQL' }).click();
  const deVolta = nb.locator('[data-celula]').nth(n + 1);
  await escreverERodar(deVolta, "SELECT id, titulo FROM provas WHERE titulo IN {{nomes}} AND titulo <> 'primeira'");
  const saidaDeVolta = await saidaDe(deVolta);
  marcar('{{nomes}} no SQL usa a lista que o Python criou', saidaDeVolta.includes('segunda') && !saidaDeVolta.includes('primeira'),
    JSON.stringify(saidaDeVolta.slice(0, 100)));

  await nb.locator(`[data-adicionar="${n + 2}"]`).getByRole('button', { name: 'Python' }).click();
  const lenta = nb.locator('[data-celula]').nth(n + 2);
  await escreverERodar(lenta, 'import time\ntime.sleep(30)');
  await pagina.waitForTimeout(600);
  const antesDeParar = Date.now();
  await nb.getByRole('button', { name: 'Parar' }).click();
  const saidaLenta = await saidaDe(lenta, 8000);
  marcar('Parar interrompe um sleep(30) na hora', saidaLenta.includes('Interrompido') && Date.now() - antesDeParar < 5000,
    `${Date.now() - antesDeParar} ms`);

  await escreverERodar(usa, 'nomes');
  marcar('depois de Parar, as variáveis continuam lá', (await saidaDe(usa)).includes('primeira'));

  await nb.getByRole('button', { name: 'Reiniciar kernel' }).click();
  await pagina.waitForTimeout(1500);
  await escreverERodar(usa, 'nomes');
  marcar('Reiniciar ZERA as variáveis', (await saidaDe(usa)).includes('NameError'));

  // ---- salvar ----
  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  let gravado = null;
  try { gravado = JSON.parse(readFileSync(arquivo, 'utf8')); } catch { /* fica null */ }
  const celulaSql = gravado?.celulas?.find((c) => c.tipo === 'sql');
  marcar('Ctrl+S grava um .brnb com kernel, conexão e células',
    gravado?.formato === 'braytech-notebook' && gravado?.kernel === 'python'
      && gravado?.conexao?.database === 'main' && gravado?.celulas?.length === 7,
    JSON.stringify({ kernel: gravado?.kernel, conexao: gravado?.conexao, celulas: gravado?.celulas?.length }));
  marcar('a SAÍDA da célula SQL fica guardada no arquivo, como no Jupyter',
    celulaSql?.saidas?.[0]?.tipo === 'tabela' && JSON.stringify(celulaSql.saidas[0].linhas).includes('primeira'));

  // ---- reabrir: a saída volta sem rodar ----
  await pagina.goto(url);
  await pagina.locator('[data-notebook]').waitFor({ timeout: 30000 });
  const reaberta = pagina.locator('[data-tipo="sql"]').first().locator('[data-saida="tabela"]');
  marcar('reabrir mostra a saída guardada, sem rodar de novo',
    await reaberta.waitFor({ timeout: 10000 }).then(() => true, () => false));

  // `CAPTURA=arquivo.png` guarda a tela com as saídas: o olho que a guarda não tem.
  if (process.env.CAPTURA) await pagina.screenshot({ path: process.env.CAPTURA });

  // ---- limpar saídas ----
  await pagina.locator('[data-notebook]').getByRole('button', { name: 'Limpar saídas' }).click();
  await pagina.waitForTimeout(300);
  marcar('"Limpar saídas" tira todas as saídas',
    (await pagina.locator('[data-notebook] [data-saidas]').count()) === 0);

  // ---- etapa 3: notebooks TypeScript e PHP, pelo "Rodar tudo" ----
  for (const [kernel, codigo] of [
    ['typescript', 'const titulos: string[] = pedidos.map((p) => p.titulo)\ntitulos.join(" + ")'],
    ['php', 'implode(" + ", array_column($pedidos, "titulo"))'],
  ]) {
    const arq = path.join(pasta, `${kernel}.brnb`);
    writeFileSync(arq, JSON.stringify({
      formato: 'braytech-notebook', versao: 1, kernel, laravel: false,
      conexao: { connectionId: conexao.id, database: 'main' },
      celulas: [
        { id: 'a', tipo: 'sql', nome: 'pedidos', conteudo: 'SELECT titulo FROM provas ORDER BY id', saidas: [] },
        { id: 'b', tipo: 'codigo', conteudo: codigo, saidas: [] },
      ],
    }));
    await pagina.goto(`${BASE}/?abrirPasta=${encodeURIComponent(pasta)}&abrirArquivo=${encodeURIComponent(arq)}`);
    // A sessão restaura as abas anteriores e deixa ativa a de antes: clica na
    // aba DESTE arquivo, e mira o notebook visível.
    await pagina.locator(`[data-tab="${kernel}.brnb"]`).first().click({ timeout: 30000 });
    const nbk = pagina.locator('[data-notebook]:visible');
    await nbk.waitFor({ timeout: 30000 });
    await nbk.getByRole('button', { name: 'Rodar tudo' }).click();
    const ultima = nbk.locator('[data-celula="b"]');
    const inicio = Date.now();
    let texto = '';
    while (Date.now() - inicio < 20000) {
      texto = await ultima.locator('[data-saidas]').innerText().catch(() => '');
      if (texto.includes('primeira') || /Error|erro/i.test(texto)) break;
      await pagina.waitForTimeout(150);
    }
    if (process.env.DEPURAR === '1') {
      console.error(`[${kernel}]`, JSON.stringify((await nbk.innerText()).slice(0, 600)));
      await pagina.screenshot({ path: `${process.env.CAPTURA ?? '/tmp'}-${kernel}.png` });
    }
    marcar(`notebook ${kernel}: "Rodar tudo" leva o SQL até a célula de código`,
      texto.includes("'primeira + segunda'"), JSON.stringify(texto.slice(0, 120)));
  }

  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0,
    errosDaPagina.slice(0, 2).join(' | '));
} catch (erro) {
  marcar('a verificação rodou até o fim', false, erro instanceof Error ? erro.message.split('\n')[0] : String(erro));
} finally {
  await navegador?.close();
  motor.kill();
  rmSync(casa, { recursive: true, force: true });
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
