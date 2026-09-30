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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(import.meta.dirname, '../..');
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
db.exec("CREATE TABLE provas (id INTEGER PRIMARY KEY, titulo TEXT); INSERT INTO provas (titulo) VALUES ('primeira'), ('segunda');");
db.close();

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
        // "escolher" pega a primeira opção; "pedirTexto" aceita o sugerido.
        if (m.acao === 'escolher') responder(m.id, true, m.args.opcoes[0]?.valor ?? null);
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
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));
  await pagina.route(`${BASE}/nb/**`, async (rota) => {
    const nome = new URL(rota.request().url()).pathname.replace('/nb/', '');
    if (nome === 'pagina.html') {
      const config = {
        base: BASE, caminho, titulo: 'analise.brnb', conteudo: '', tema: 'escuro',
        fontSize: 13, tabSize: 2, raiz: pasta,
      };
      return rota.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8">
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
  const saidaDe = async (celula) => {
    const inicio = Date.now();
    while (Date.now() - inicio < 20000) {
      const t = await celula.locator('[data-saidas]').innerText().catch(() => '');
      if (t !== '' && !/\[\*\]/.test(await celula.innerText())) return t;
      await pagina.waitForTimeout(150);
    }
    return '';
  };

  await nb.locator('[data-adicionar="1"]').getByRole('button', { name: 'SQL' }).click();
  const sql = nb.locator('[data-celula]').nth(1);
  await escreverERodar(sql, 'SELECT titulo FROM provas ORDER BY id');
  const saidaSql = await saidaDe(sql);
  marcar('SQL roda pelo motor EMPACOTADO e vira variável', /→ resultado1/.test(saidaSql), JSON.stringify(saidaSql.slice(-60)));

  const py = nb.locator('[data-celula]').first();
  await escreverERodar(py, '[r["titulo"].upper() for r in resultado1]');
  const saidaPy = await saidaDe(py);
  marcar('a célula Python usa o resultado', saidaPy.includes("['PRIMEIRA', 'SEGUNDA']"), JSON.stringify(saidaPy.slice(0, 60)));

  const final = JSON.parse((await documento()) ?? '{}');
  marcar('o documento leva as saídas e a conexão, como o Ctrl+S gravaria',
    final.conexao?.database === 'main' && final.celulas?.some((c) => c.saidas?.length > 0));

  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0, errosDaPagina.slice(0, 2).join(' | '));
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
