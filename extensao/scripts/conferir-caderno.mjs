// Um bloco do `.sqlbook` com várias queries: uma tela Results para cada.
//
// Ele (30/09): *"se eu coloco mais de uma query dentro de um bloco, ele da
// erro, diz que está na aba Problems, mas não mostra nada. O que deveria
// acontecer, se tem mais de uma query (e é bem nitido que tem, pois termina com
// ; cada query), deveria rodar e gerar uma tela "Results" para cada query."*
//
// Motor de verdade, SQLite descartável, a webview do caderno no Chrome e um
// HOST de mentira no lugar do editor: ele repassa as chamadas de API ao motor
// (como a `PonteDoHost`) e anota cada "abrir Results" pedido — é assim que se
// conta quantas telas abririam no Cursor.
//
//   npm run conferir:caderno
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const WEB = path.resolve(process.argv[2] ?? path.join(RAIZ, 'extensao/webview'));
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const PORTA = 4499;
const BASE = `http://127.0.0.1:${PORTA}`;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-caderno-'));

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

const banco = path.join(casa, 'exemplo.db');
const db = new DatabaseSync(banco);
db.exec("CREATE TABLE provas (id INTEGER PRIMARY KEY, titulo TEXT); INSERT INTO provas (titulo) VALUES ('primeira'), ('segunda');");
db.close();

/** O editor, do ponto de vista da webview: a API passa por ele. */
const HOST = `
  window.__pedidos = [];
  window.acquireVsCodeApi = () => ({
    getState() { return undefined; },
    setState() {},
    postMessage(m) {
      window.__pedidos.push(m);
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

const motor = spawn(process.execPath, [MOTOR], {
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: String(PORTA),
    DEV_IDE_HOME: path.join(casa, 'casa'),
    DEV_IDE_VAULT: path.join(casa, 'vault.json'),
    DEV_IDE_SESSION: path.join(casa, 'sessao.json'),
  },
});
const api = async (rota, corpo) =>
  (await fetch(`${BASE}${rota}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    ...(corpo === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
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
  const pagina = await (await navegador.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));

  let conteudo = '';
  await pagina.route(`${BASE}/caderno/**`, async (rota) => {
    const nome = new URL(rota.request().url()).pathname.replace('/caderno/', '');
    if (nome === 'pagina.html') {
      const config = {
        base: BASE, caminho: path.join(casa, 'exemplo.sqlbook'), titulo: 'exemplo.sqlbook',
        conteudo, tema: 'escuro', fontSize: 13, tabSize: 2,
        connectionId: conexao.id, database: 'main',
      };
      return rota.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{height:100%;margin:0}#raiz{height:100%}</style>
${existsSync(path.join(WEB, 'caderno.css')) ? '<link rel="stylesheet" href="caderno.css">' : ''}
</head><body class="vscode-dark"><div id="raiz"></div>
<script>${HOST}</script>
<script>window.BRAYTECH=${JSON.stringify(config)};</script>
<script src="caderno.js"></script></body></html>`,
      });
    }
    const arquivo = path.join(WEB, nome);
    if (!existsSync(arquivo)) return rota.fulfill({ status: 404 });
    const tipo = nome.endsWith('.js') ? 'text/javascript' : nome.endsWith('.css') ? 'text/css' : undefined;
    return rota.fulfill({ body: readFileSync(arquivo), contentType: tipo });
  });

  /** Abre o caderno com UM bloco e aperta o `▷ Run` dele. */
  const rodarBloco = async (sql) => {
    conteudo = JSON.stringify({ versao: 3, celulas: [{ linguagem: 'sql', conteudo: sql }] });
    await pagina.goto(`${BASE}/caderno/pagina.html`);
    await pagina.locator('[data-bloco]').first().waitFor({ timeout: 20000 });
    await pagina.getByText('▷ Run').first().click();
    await pagina.waitForTimeout(1500);
    const pedidos = await pagina.evaluate(() => window.__pedidos);
    return {
      abertos: pedidos.filter((p) => p.tipo === 'abrirResultado'),
      texto: await pagina.locator('body').innerText(),
    };
  };

  // ---- duas queries, duas telas ----
  const dois = await rodarBloco('SELECT titulo FROM provas WHERE id = 1;\nSELECT count(*) AS total FROM provas;');
  marcar('duas queries no bloco abrem DUAS telas Results', dois.abertos.length === 2,
    `${dois.abertos.length} aberta(s)`);
  marcar('cada tela traz o resultado da SUA query',
    dois.abertos[0]?.resultado?.rows?.[0]?.[0] === 'primeira'
      && dois.abertos[1]?.resultado?.rows?.[0]?.[0] === 2,
    JSON.stringify(dois.abertos.map((a) => a.resultado?.rows)));
  marcar('as telas têm nomes diferentes (uma não repinta a outra)',
    new Set(dois.abertos.map((a) => a.titulo)).size === dois.abertos.length,
    JSON.stringify(dois.abertos.map((a) => a.titulo)));
  marcar('nenhuma mensagem de erro no caderno', !/falhou/i.test(dois.texto));

  // ---- uma query só continua como sempre ----
  const uma = await rodarBloco('SELECT titulo FROM provas');
  marcar('uma query sem ; continua abrindo UMA tela', uma.abertos.length === 1,
    `${uma.abertos.length} aberta(s)`);

  // ---- a segunda falha: para ali, e diz o motivo ----
  const falha = await rodarBloco('SELECT 1 AS um;\nSELECT * FROM tabela_que_nao_existe;\nSELECT 3;');
  marcar('para na instrução que falhou (a primeira abre, a terceira não roda)',
    falha.abertos.length === 1, `${falha.abertos.length} aberta(s)`);
  marcar('o erro aparece NO CADERNO, dizendo qual instrução e o que o banco disse',
    /instrução 2 de 3 falhou/i.test(falha.texto) && /tabela_que_nao_existe/i.test(falha.texto),
    JSON.stringify((falha.texto.match(/[^\n]*falhou[^\n]*/i) ?? [''])[0].slice(0, 160)));
  marcar('e não manda procurar uma aba Problems que a extensão não tem',
    !/aba Problems/i.test(falha.texto));

  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0,
    errosDaPagina.slice(0, 2).join(' | '));
} catch (erro) {
  marcar('a verificação rodou até o fim', false, erro instanceof Error ? erro.message : String(erro));
} finally {
  await navegador?.close();
  motor.kill();
  rmSync(casa, { recursive: true, force: true });
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
