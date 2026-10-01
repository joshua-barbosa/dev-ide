// O notebook `.brnb` NA EXTENSÃO (spec 112, etapa 6).
//
// A webview `notebook.js` no Chrome, com o motor EMPACOTADO (o do `.vsix`) e um
// editor de mentira no lugar do VS Code: ele repassa a API ao motor, responde
// às perguntas (escolher, pedir texto) e anota cada texto novo que a webview
// manda aplicar no documento — é o que o editor personalizado faria.
//
//   npm run build:extensao && npm run conferir:notebook-extensao
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(import.meta.dirname, '../..');
// A MESMA CSP da webview real (compilada por \`build:server\`): um worker que a
// política bloqueia só apareceria no Cursor.
const { politicaDaWebview } = await import(path.join(RAIZ, 'dist/shared/extensao/politica-da-webview.js'));
const WEB = path.resolve(process.argv[2] ?? path.join(RAIZ, 'extensao/webview'));
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'extensao/motor/servidor.js');
const PORTA = 4511;
const BASE = `http://127.0.0.1:${PORTA}`;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-nb-ext-'));
const pasta = path.join(casa, 'projeto');
mkdirSync(pasta);
const caminho = path.join(pasta, 'analise.brnb');

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

const banco = path.join(casa, 'exemplo.db');
const db = new DatabaseSync(banco);
db.exec("CREATE TABLE provas (id INTEGER PRIMARY KEY, titulo TEXT); INSERT INTO provas (titulo) VALUES ('primeira'), ('segunda'); CREATE TABLE matriculas_exemplo (id INTEGER PRIMARY KEY);");
db.close();

/**
 * Um notebook com SEIS tabelas de 500 linhas guardadas — o relato de 01/10:
 * "quando retorna uma consulta ou vai salvando vários resultados, a página
 * do brnb fica lenta de editar as células" (era 1,5 s por tecla, picos de 3 s).
 */
const NOTEBOOK_GRANDE = (() => {
  const colunas = ['id', 'nome', 'email', 'total', 'status', 'dia', 'obs', 'grupo'];
  const linhas = Array.from({ length: 500 }, (_, i) =>
    [i, `cliente ${i}`, `email${i}@exemplo.test`, i * 1.5, 'ativo', '2026-10-01', `obs ${i}`, i % 7]);
  const celulas = Array.from({ length: 6 }, (_, k) => ({
    id: `s${k}`, tipo: 'sql', linguagem: null, conteudo: `SELECT * FROM t${k}`, nome: `r${k}`, conexao: null,
    paraCada: null, contador: k + 1, saidas: [{ tipo: 'tabela', colunas, linhas, total: 500 }],
  }));
  celulas.push({ id: 'c1', tipo: 'codigo', linguagem: 'typescript', conteudo: 'const x = 1', nome: null, conexao: null, paraCada: null, contador: null, saidas: [] });
  return JSON.stringify({ formato: 'braytech-notebook', versao: 1, kernel: 'typescript', conexao: null, laravel: false, celulas }, null, 2);
})();

/** O editor, visto pela webview: API, perguntas, e o documento. */
const EDITOR = `
  window.__documento = [];
  const responder = (id, ok, data, erro) => window.postMessage({ tipo: 'hostResposta', id, ok, data, erro }, '*');
  window.acquireVsCodeApi = () => ({
    getState() { return undefined; },
    setState() {},
    postMessage(m) {
      if (m.tipo === 'notebookMudou') { window.__documento.push(m.conteudo); return; }
      if (m.tipo === 'hostChamada') {
        // "escolher" pega a opção cujo rótulo contém \`__escolha\` (ou a
        // primeira), e anota a pergunta; "pedirTexto" aceita o sugerido.
        if (m.acao === 'escolher') {
          (window.__perguntas ??= []).push(m.args.titulo);
          const alvo = window.__escolha ? m.args.opcoes.find((o) => o.rotulo.includes(window.__escolha)) : m.args.opcoes[0];
          responder(m.id, true, alvo?.valor ?? null);
        }
        else if (m.acao === 'pedirTexto') responder(m.id, true, m.args.valorInicial ?? null);
        else responder(m.id, false, null, 'ação não simulada: ' + m.acao);
        return;
      }
      if (m.tipo !== 'api') return;
      fetch('${BASE}' + m.rota, {
        method: m.metodo,
        headers: m.corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        body: m.corpo === undefined ? undefined : JSON.stringify(m.corpo),
      })
        .then((r) => r.json())
        .then((r) => window.postMessage({ tipo: 'apiResposta', id: m.id, ok: r.success === true, data: r.data, erro: r.error }, '*'))
        .catch((e) => window.postMessage({ tipo: 'apiResposta', id: m.id, ok: false, erro: String(e) }, '*'));
    },
  });
`;

const motor = spawn(process.execPath, ['-e', `require(${JSON.stringify(MOTOR)}).iniciarServidor(${PORTA})`], {
  stdio: 'ignore',
  env: { ...process.env, HOME: casa, USERPROFILE: casa, DEV_IDE_HOME: '', DEV_IDE_VAULT: '' },
  cwd: tmpdir(),
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
  if (!de_pe) throw new Error('o motor empacotado não subiu');
  await api('/api/connections/vault', {});
  await api('/api/connections', { type: 'sqlite', label: 'exemplo', group: 'Exemplos', readOnly: false, fields: { file: banco } });

  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const pagina = await (await navegador.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(process.env.PILHA ? String(e.stack).split('\n').slice(0, 4).join(' ~ ') : e.message));
  await pagina.route(`${BASE}/nb/**`, async (rota) => {
    const nome = new URL(rota.request().url()).pathname.replace('/nb/', '');
    if (nome === 'pagina.html') {
      // \`?arquivo=\` abre outro notebook da mesma pasta (o do kernel JS).
      const arquivo = new URL(rota.request().url()).searchParams.get('arquivo');
      const config = {
        base: BASE, caminho: arquivo === null ? caminho : path.join(pasta, arquivo),
        titulo: arquivo ?? 'analise.brnb', conteudo: arquivo === 'grande.brnb' ? NOTEBOOK_GRANDE : '', tema: 'escuro',
        fontSize: 13, tabSize: 2, raiz: pasta, recursos: `${BASE}/nb/assets/`,
      };
      return rota.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${politicaDaWebview(BASE, "'unsafe-inline'")} connect-src ${BASE};">
<style>html,body{height:100%;margin:0}#raiz{height:100%;display:flex;flex-direction:column}#raiz>*{flex:1 1 auto;min-height:0}</style>
${existsSync(path.join(WEB, 'notebook.css')) ? '<link rel="stylesheet" href="notebook.css">' : ''}
</head><body class="vscode-dark"><div id="raiz"></div>
<script>${EDITOR}</script>
<script>window.BRAYTECH=${JSON.stringify(config)};</script>
<script src="notebook.js"></script></body></html>`,
      });
    }
    const arquivo = path.join(WEB, nome);
    if (!existsSync(arquivo)) return rota.fulfill({ status: 404 });
    const tipo = nome.endsWith('.js') ? 'text/javascript' : nome.endsWith('.css') ? 'text/css' : undefined;
    return rota.fulfill({ body: readFileSync(arquivo), contentType: tipo });
  });
  await pagina.goto(`${BASE}/nb/pagina.html`);

  const documento = () => pagina.evaluate(() => window.__documento.at(-1) ?? null);
  const escolha = pagina.locator('[data-notebook-escolher-kernel]');
  marcar('arquivo .brnb vazio abre perguntando o kernel',
    await escolha.waitFor({ timeout: 20000 }).then(() => true, () => false));
  await escolha.getByRole('button', { name: 'Python' }).click();
  await pagina.locator('[data-notebook]').waitFor();
  marcar('escolher o kernel vira TEXTO NOVO no documento (o "não salvo" do editor)',
    JSON.parse((await documento()) ?? '{}').kernel === 'python');

  const nb = pagina.locator('[data-notebook]');
  await nb.getByRole('button', { name: 'Conexão do notebook' }).click();
  await pagina.waitForTimeout(800);
  const rotulo = await nb.getByRole('button', { name: 'Conexão do notebook' }).innerText();
  marcar('o seletor da extensão acha o database do SQLite', /exemplo · main/.test(rotulo), JSON.stringify(rotulo));

  const escreverERodar = async (celula, codigo) => {
    await celula.locator('textarea').first().click();
    await celula.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
    await pagina.keyboard.press('Control+A');
    await pagina.keyboard.type(codigo);
    await celula.getByRole('button', { name: /Rodar célula/ }).click();
  };
  /** A saída da célula, quando ela terminar. `anterior`: a de uma execução passada, que não vale. */
  const saidaDe = async (celula, anterior = null) => {
    const inicio = Date.now();
    while (Date.now() - inicio < 20000) {
      // textContent, e não innerText: a tabela de uma saída fora da tela não é
      // desenhada (content-visibility: auto) e some do innerText.
      const t = await celula.locator('[data-saidas]').evaluate((el) => el.textContent ?? '').catch(() => '');
      if (t !== '' && t !== anterior && !/\[\*\]/.test(await celula.innerText())) return t;
      await pagina.waitForTimeout(150);
    }
    return '';
  };

  await nb.locator('[data-adicionar="1"]').getByRole('button', { name: 'SQL' }).click();
  const sql = nb.locator('[data-celula]').nth(1);
  await escreverERodar(sql, 'SELECT titulo FROM provas ORDER BY id');
  const saidaSql = await saidaDe(sql);
  marcar('SQL roda pelo motor EMPACOTADO e vira variável', /→ resultado1/.test(saidaSql), JSON.stringify(saidaSql.slice(-60)));

  // O autocomplete de SQL: o catálogo do banco da célula. Ele relatou ter de
  // digitar tabela e coluna de cabeça.
  // O Monaco só existe na célula em foco; fora dela é uma textarea.
  await sql.locator('textarea').first().click();
  await sql.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.keyboard.press('Control+End');
  await pagina.keyboard.press('Enter');
  // Uma tabela que NÃO está escrita em lugar nenhum: o Monaco também sugere
  // as palavras do próprio texto, e "provas" passaria verde sem catálogo.
  await pagina.keyboard.type('SELECT * FROM matr');
  await pagina.keyboard.press('Control+Space');
  const sugestao = await pagina.locator('.suggest-widget .monaco-list-row', { hasText: 'matriculas_exemplo' })
    .first().waitFor({ timeout: 8000 }).then(() => true, () => false);
  marcar('célula SQL completa o nome da tabela pelo catálogo', sugestao);
  await pagina.keyboard.press('Escape');

  const py = nb.locator('[data-celula]').first();
  await escreverERodar(py, '[r["titulo"].upper() for r in resultado1]');
  const saidaPy = await saidaDe(py);
  marcar('a célula Python usa o resultado', saidaPy.includes("['PRIMEIRA', 'SEGUNDA']"), JSON.stringify(saidaPy.slice(0, 60)));

  const final = JSON.parse((await documento()) ?? '{}');
  marcar('o documento leva as saídas e a conexão, como o Ctrl+S gravaria',
    final.conexao?.database === 'main' && final.celulas?.some((c) => c.saidas?.length > 0));

  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0, errosDaPagina.slice(0, 2).join(' | '));

  // ---- Kernel JS: um frontend e um backend no mesmo workspace ----
  // Um colega dele: *"não me deixa trocar… não sei nem qual dos dois ele
  // escolheu"*. Clicar na barra PERGUNTA (mesmo parado), e a pasta escolhida
  // é de onde o require vem.
  for (const [proj, frase] of [['frontend', 'do front'], ['backend', 'do back']]) {
    mkdirSync(path.join(pasta, proj, 'node_modules', 'origem'), { recursive: true });
    writeFileSync(path.join(pasta, proj, 'package.json'), '{}');
    writeFileSync(path.join(pasta, proj, 'node_modules', 'origem', 'index.js'), `module.exports = '${frase}';`);
  }
  await pagina.goto(`${BASE}/nb/pagina.html?arquivo=web.brnb`);
  // TypeScript: o kernel é o mesmo Node, e o editor de TS acusa nome
  // desconhecido (o de JS não) — é onde o "patients em vermelho" aparece.
  await pagina.locator('[data-notebook-escolher-kernel]').getByRole('button', { name: 'TypeScript' }).click();
  const web = pagina.locator('[data-notebook]');
  await web.waitFor();
  await pagina.evaluate(() => { window.__perguntas = []; window.__escolha = 'Pacotes: backend'; });
  await web.getByRole('button', { name: 'Interpretador do kernel' }).click();
  const barra = web.getByRole('button', { name: 'Interpretador do kernel' });
  const inicio = Date.now();
  let textoDaBarra = '';
  while (Date.now() - inicio < 20000 && !/pacotes: backend/.test(textoDaBarra)) {
    textoDaBarra = await barra.innerText();
    await pagina.waitForTimeout(200);
  }
  const perguntas = await pagina.evaluate(() => window.__perguntas);
  marcar('kernel parado: clicar na barra PERGUNTA, em vez de subir sozinho',
    perguntas.some((t) => /pacotes/.test(t)), JSON.stringify(perguntas));
  marcar('a barra diz de onde vêm os pacotes', /pacotes: backend/.test(textoDaBarra), JSON.stringify(textoDaBarra));
  const celulaJs = web.locator('[data-celula]').first();
  await escreverERodar(celulaJs, "require('origem')");
  const saidaJs = await saidaDe(celulaJs);
  marcar('o require vem da pasta escolhida', saidaJs.includes("'do back'"), JSON.stringify(saidaJs.slice(0, 60)));

  await pagina.evaluate(() => { window.__escolha = 'Pacotes: frontend'; });
  await barra.click();
  const inicio2 = Date.now();
  while (Date.now() - inicio2 < 20000 && !/pacotes: frontend/.test(await barra.innerText())) await pagina.waitForTimeout(200);
  await escreverERodar(celulaJs, "require('origem')");
  // A MESMA célula rodou antes: a saída de lá ('do back') ainda está na tela
  // até esta execução começar.
  const saidaJs2 = await saidaDe(celulaJs, saidaJs);
  marcar('trocar a pasta troca o require', saidaJs2.includes("'do front'"), JSON.stringify(saidaJs2.slice(0, 60)));

  // O worker de JS/TS do Monaco: sem ele, nada de autocomplete de JS e um
  // "Invalid base URL" por tecla no console. \`abs\` não está escrito em lugar
  // nenhum — só o worker o conhece.
  await celulaJs.locator('textarea').first().click();
  await celulaJs.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.keyboard.press('Control+A');
  await pagina.keyboard.type('Math.');
  await pagina.keyboard.press('Control+Space');
  const doWorker = await pagina.locator('.suggest-widget .monaco-list-row', { hasText: 'abs' })
    .first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  marcar('célula TypeScript completa pelo worker do Monaco (Math.abs)', doWorker);
  await pagina.keyboard.press('Escape');
  // As variáveis de FORA da célula. O relato (0.1.12): *"quando eu passei o
  // patients, ele ficou em vermelho, como se não conhecesse a variavel"* — o
  // patients vinha de uma célula SQL. Aqui: SQL → patients, e uma célula
  // TypeScript que o usa tem de ficar SEM sublinhado e completar a coluna.
  // O "escolher" de mentira volta a pegar a primeira opção (a conexão).
  await pagina.evaluate(() => { window.__escolha = null; });
  await web.getByRole('button', { name: 'Conexão do notebook' }).click();
  await pagina.waitForTimeout(800);
  await web.locator('[data-adicionar="1"]').getByRole('button', { name: 'SQL' }).click();
  const sqlWeb = web.locator('[data-celula]').nth(1);
  await sqlWeb.getByRole('textbox', { name: 'Nome do resultado' }).fill('patients');
  await escreverERodar(sqlWeb, 'SELECT id, titulo FROM provas ORDER BY id');
  const saidaPatients = await saidaDe(sqlWeb);
  marcar('a SQL → patients rodou', /→ patients/.test(saidaPatients), JSON.stringify(saidaPatients.slice(-50)));
  await web.locator('[data-adicionar="2"]').getByRole('button', { name: 'TypeScript' }).click();
  const tsCel = web.locator('[data-celula]').nth(2);
  await tsCel.locator('textarea').first().click();
  await tsCel.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  // As declarações chegam ao editor ao FOCAR a célula; quem digita leva mais
  // que isto para começar.
  await pagina.waitForTimeout(1500);
  await pagina.keyboard.type('const nomes = patients.map((p) => p.');
  await pagina.keyboard.press('Control+Space');
  const coluna = await pagina.locator('.suggest-widget .monaco-list-row', { hasText: 'titulo' })
    .first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  marcar('célula TS completa a COLUNA do resultado do SQL (p.titulo)', coluna);
  await pagina.keyboard.press('Escape');
  await pagina.keyboard.type('titulo)');
  await pagina.waitForTimeout(2500);
  const sublinhados = await tsCel.locator('.squiggly-error').count();
  marcar('a variável do SQL não fica em vermelho na célula TS', sublinhados === 0, `${sublinhados} sublinhado(s)`);
  if (process.env.CAPTURA) await pagina.screenshot({ path: `${process.env.CAPTURA}-patients.png` });

  // E o TIPO do que outra célula criou. O relato seguinte: *"eu criei um const
  // users do patients e na celula seguida não reconheceu o tipo do u dentro do
  // forEach do users"*. users = patients.map(...) numa célula; na outra,
  // users.forEach((u) => u.) tem de sugerir o campo que o map criou.
  await pagina.keyboard.press('Control+A');
  await pagina.keyboard.type('const users = patients.map((p) => ({ apelido: p.titulo }))');
  await web.locator('[data-adicionar="3"]').getByRole('button', { name: 'TypeScript' }).click();
  const tsCel2 = web.locator('[data-celula]').nth(3);
  await tsCel2.locator('textarea').first().click();
  await tsCel2.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.waitForTimeout(1500);
  await pagina.keyboard.type('users.forEach((u) => u.');
  await pagina.keyboard.press('Control+Space');
  const doMap = await pagina.locator('.suggest-widget .monaco-list-row', { hasText: 'apelido' })
    .first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  marcar('célula TS conhece o TIPO do que outra célula criou (u.apelido)', doMap);
  await pagina.keyboard.press('Escape');
  await pagina.keyboard.type('apelido)');
  await pagina.waitForTimeout(2500);
  const sublinhados2 = await tsCel2.locator('.squiggly-error').count();
  marcar('e nada fica em vermelho nela', sublinhados2 === 0, `${sublinhados2} sublinhado(s)`);
  if (process.env.CAPTURA) await pagina.screenshot({ path: `${process.env.CAPTURA}-users.png` });

  // ---- Várias linguagens no mesmo notebook (spec 113) ----
  // A célula TS que cria users RODA; uma célula nova vira Python pelo seletor
  // e recebe o users do Node; a TS seguinte recebe o que o Python mudou.
  const celUsers = web.locator('[data-celula]').nth(2);
  await celUsers.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(celUsers).catch(() => '');
  // A célula Python nasce pelo "+ outra linguagem" (o relato: o adicionar
  // "ainda está mostrando somente Javascript + SQL + Markdown").
  await web.locator('[data-adicionar="4"]').getByRole('combobox', { name: 'Adicionar célula de outra linguagem' })
    .selectOption('python');
  const py2 = web.locator('[data-celula]').nth(4);
  // As opções do seletor: o relato foi "o select ficou em branco as options".
  // O sistema desenha a lista com fundo claro; a opção tem de trazer o seu.
  const coresDasOpcoes = await web.locator('[data-adicionar="4"] select option').evaluateAll((os) =>
    os.map((o) => { const c = getComputedStyle(o); return [c.color, c.backgroundColor]; }));
  marcar('as opções do seletor têm fundo e cor próprios (não somem no tema escuro)',
    coresDasOpcoes.length > 0 && coresDasOpcoes.every(([cor, fundo]) => fundo !== 'rgba(0, 0, 0, 0)' && cor !== fundo),
    JSON.stringify(coresDasOpcoes[0]));
  marcar('"+ outra linguagem" cria a célula já em Python',
    (await py2.getByRole('combobox', { name: 'Linguagem da célula' }).inputValue()) === 'python');
  // Numa linha só: o Monaco recua sozinho depois de "users:", e a linha
  // seguinte cairia dentro do for.
  await escreverERodar(py2, "for u in users: u['grito'] = u['apelido'].upper()\nlen(users), users[0]['apelido']");
  const saidaPy2 = await saidaDe(py2);
  marcar('célula Python recebe o users criado no TypeScript', saidaPy2.includes("(2, 'primeira')"), JSON.stringify(saidaPy2.slice(0, 80)));
  await web.locator('[data-adicionar="5"]').getByRole('button', { name: 'Python' }).click();
  const ts3 = web.locator('[data-celula]').nth(5);
  await ts3.getByRole('combobox', { name: 'Linguagem da célula' }).selectOption('typescript');
  await escreverERodar(ts3, 'users.map((u: any) => u.grito).join(",")');
  const saidaTs3 = await saidaDe(ts3);
  marcar('a TS seguinte recebe o que o Python mudou POR DENTRO', saidaTs3.includes("'PRIMEIRA,SEGUNDA'"), JSON.stringify(saidaTs3.slice(0, 80)));
  const barraMista = await web.locator('[data-kernel]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kernel')));
  marcar('a barra mostra um kernel por linguagem', barraMista.includes('python') && barraMista.some((k) => k === 'typescript' || k === 'javascript'),
    JSON.stringify(barraMista));
  const arquivoMisto = JSON.parse((await documento()) ?? '{}');
  marcar('o .brnb misto grava a linguagem de cada célula (versão 2)',
    arquivoMisto.versao === 2 && arquivoMisto.celulas?.some((c) => c.linguagem === 'python'));
  if (process.env.CAPTURA) await pagina.screenshot({ path: `${process.env.CAPTURA}-misto.png` });

  // O relato (0.1.16): com uma célula Python no notebook, o users de outra
  // célula voltou a dar "Cannot find name 'users'". A conferência do tipo
  // acima rodava ANTES de existir célula Python; esta roda depois.
  await web.locator('[data-adicionar="6"]').getByRole('button', { name: 'TypeScript' }).click();
  const ts4 = web.locator('[data-celula]').nth(6);
  await ts4.locator('textarea').first().click();
  await ts4.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.waitForTimeout(1500);
  await pagina.keyboard.type('const mensagens = users.map((u) => u.');
  await pagina.keyboard.press('Control+Space');
  const depoisDoPython = await pagina.locator('.suggest-widget .monaco-list-row', { hasText: 'apelido' })
    .first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  await pagina.keyboard.press('Escape');
  await pagina.keyboard.type('apelido)');
  await pagina.waitForTimeout(2500);
  const sublinhados4 = await ts4.locator('.squiggly-error').count();
  marcar('com célula Python no notebook, o users de outra célula continua conhecido',
    depoisDoPython && sublinhados4 === 0, `sugeriu: ${depoisDoPython} · ${sublinhados4} sublinhado(s)`);
  if (process.env.CAPTURA) await pagina.screenshot({ path: `${process.env.CAPTURA}-depois-do-python.png` });

  // sql() dentro da célula (spec 114, C), pela conexão do notebook, com ?.
  await web.locator('[data-adicionar="7"]').getByRole('button', { name: 'TypeScript' }).click();
  const comSql = web.locator('[data-celula]').nth(7);
  await escreverERodar(comSql, "(await sql('SELECT titulo FROM provas WHERE id = ?', [2]))[0].titulo");
  const saidaSql2 = await saidaDe(comSql);
  marcar('sql() na célula TS lê pela conexão do notebook', saidaSql2.includes("'segunda'"), JSON.stringify(saidaSql2.slice(0, 80)));
  await pagina.waitForTimeout(1500);
  marcar('o editor conhece o sql() (sem vermelho)', (await comSql.locator('.squiggly-error').count()) === 0);

  // "Para cada item" (spec 114, B): uma lista no kernel, e a célula SQL roda
  // uma vez por item, com {{item}}.
  await web.locator('[data-adicionar="8"]').getByRole('button', { name: 'TypeScript' }).click();
  const celIds = web.locator('[data-celula]').nth(8);
  await escreverERodar(celIds, 'const idsTeste = [2, 1]');
  await saidaDe(celIds).catch(() => '');
  await web.locator('[data-adicionar="9"]').getByRole('button', { name: 'SQL' }).click();
  const celCada = web.locator('[data-celula]').nth(9);
  await celCada.getByRole('textbox', { name: 'Para cada item da lista' }).fill('idsTeste');
  await escreverERodar(celCada, 'SELECT titulo FROM provas WHERE id = {{item}}');
  const saidaCada = await saidaDe(celCada);
  marcar('"para cada" roda por item e junta numa tabela com a coluna item',
    /para cada idsTeste: 2 de 2/.test(saidaCada) && /segunda[\s\S]*primeira/.test(saidaCada), JSON.stringify(saidaCada.slice(0, 120)));

  // {{lista}} como TABELA (spec 114, D): o users do TypeScript cruzado com a
  // tabela provas do banco. O pedido: "select * from messages, onde messages
  // é array de objects".
  await web.locator('[data-adicionar="10"]').getByRole('button', { name: 'SQL' }).click();
  const celTabela = web.locator('[data-celula]').nth(10);
  await escreverERodar(celTabela, 'SELECT p.id, m.apelido FROM {{users}} m JOIN provas p ON p.titulo = m.apelido ORDER BY p.id');
  const saidaTabela = await saidaDe(celTabela);
  marcar('{{users}} vira tabela no SQL e cruza com uma tabela do banco',
    /primeira[\s\S]*segunda/.test(saidaTabela) && !/erro|falhou/i.test(saidaTabela), JSON.stringify(saidaTabela.slice(0, 120)));

  // O botão Ajuda na extensão: o mesmo painel, e o exemplo de JS (o kernel
  // desta página) — não o de Python.
  await web.getByRole('button', { name: 'Ajuda' }).click();
  const ajuda = pagina.locator('[data-ajuda-do-notebook]');
  const abriu = await ajuda.waitFor({ timeout: 5000 }).then(() => true, () => false);
  const textoDaAjuda = abriu ? await ajuda.innerText() : '';
  if (process.env.CAPTURA) await pagina.screenshot({ path: `${process.env.CAPTURA}-ajuda.png` });
  marcar('extensão: o botão Ajuda abre o painel, com exemplo do kernel TS',
    abriu && textoDaAjuda.includes('.map(') && !textoDaAjuda.includes('import pandas'));
  marcar('a Ajuda explica sql(), sql.transacao e a lista como tabela',
    textoDaAjuda.includes('await sql.transacao(') && textoDaAjuda.includes('json_to_recordset({{messagesJson}}::json)'));

  marcar('nenhum erro de JavaScript na página do kernel JS', errosDaPagina.length === 0, errosDaPagina.slice(0, 2).join(' | '));

  // ---- Digitar num notebook com muitos resultados guardados ----
  await pagina.goto(`${BASE}/nb/pagina.html?arquivo=grande.brnb`);
  const grande = pagina.locator('[data-celula="c1"]');
  await grande.waitFor({ timeout: 30000 });
  await grande.scrollIntoViewIfNeeded();
  await grande.locator('textarea').first().click();
  await grande.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.waitForTimeout(1000);
  await pagina.keyboard.press('End');
  await pagina.evaluate(() => { window.__documento = []; });
  const tempos = [];
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    await pagina.keyboard.press('a');
    await pagina.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    tempos.push(Date.now() - t0);
  }
  await pagina.waitForTimeout(500);
  tempos.sort((a, b) => a - b);
  const p90 = tempos[26];
  const mensagens = await pagina.evaluate(() => window.__documento.length);
  const ultimo = await pagina.evaluate(() => window.__documento.at(-1) ?? '');
  const textoGrande = JSON.parse(ultimo || '{}').celulas?.find((c) => c.id === 'c1')?.conteudo;
  marcar('com 6 tabelas de 500 linhas guardadas, digitar não perde tecla', textoGrande === `const x = 1${'a'.repeat(30)}`, JSON.stringify(textoGrande));
  marcar('o texto vai ao editor em lotes, não a cada tecla', mensagens > 0 && mensagens < 30, `${mensagens} mensagens para 30 teclas`);
  marcar('nenhuma tecla trava (p90 < 400 ms; antes eram ~2.900)', p90 < 400, `mediana ${tempos[15]} ms · p90 ${p90} ms`);
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
