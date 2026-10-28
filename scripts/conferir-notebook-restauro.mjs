// O relato de 28/10, usado de verdade na IDE: o kernel PHP parava sozinho
// depois de um tempo parado, e a resposta HTTP salva no `.brnb` não servia mais
// para a célula de baixo — só rodando a célula HTTP de novo.
//
// O gesto dele: abrir um notebook PHP com a resposta já guardada, rodar a
// célula de código SEM rodar a HTTP, ficar parado mais de um minuto, rodar de
// novo; e o kernel morto por fora, que a célula sobe de novo sozinha.
//
// Motor de verdade, PHP de verdade, a IDE no Chrome. Leva ~1min30 (a espera).
//
//   npm run build && npm run conferir:notebook-restauro
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const PORTA = 4506;
const BASE = `http://127.0.0.1:${PORTA}`;
const PARADO_MS = 65_000;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-notebook-restauro-'));
const pasta = path.join(casa, 'projeto');
mkdirSync(pasta);
const arquivo = path.join(pasta, 'exemplo.brnb');

// O notebook como ficou gravado depois de rodar: a resposta HTTP e um SQL
// grande demais para o arquivo (só 1 de 900 linhas guardadas).
const require = createRequire(import.meta.url);
const m = require(path.join(RAIZ, 'dist/shared/notebook/modelo.js'));
let nb = { ...m.notebookNovo('php', null), celulas: [] };
nb = m.inserirCelula(nb, 'http', 0, 'h1');
nb = m.alterarCelula(nb, 'h1', { nome: 'pedido', http: { ...nb.celulas[0].http, url: 'http://127.0.0.1:9/pedido/7' } });
nb = m.registrarExecucao(nb, 'h1', 1, [{
  tipo: 'http', status: 200, statusTexto: 'OK', tempoMs: 8, tamanho: 30, url: 'http://127.0.0.1:9/pedido/7',
  headers: [['content-type', 'application/json']], tipoDeConteudo: 'application/json',
  corpo: '{"id":7,"itens":[10,20,30]}', codificacao: 'texto', truncado: false,
}]);
nb = m.inserirCelula(nb, 'sql', 1, 's1');
nb = m.alterarCelula(nb, 's1', { nome: 'vendas', conteudo: 'SELECT * FROM vendas' });
nb = m.registrarExecucao(nb, 's1', 2, [{ tipo: 'tabela', colunas: ['id'], linhas: [[1]], total: 900 }]);
nb = m.inserirCelula(nb, 'codigo', 2, 'c1', 'php');
nb = m.alterarCelula(nb, 'c1', { conteudo: 'echo $pedido["body"]["id"] + count($pedido["body"]["itens"]);' });
writeFileSync(arquivo, m.escreverNotebook(nb));

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

const motor = spawn(process.execPath, [MOTOR], {
  stdio: 'ignore',
  env: {
    ...process.env, PORT: String(PORTA), HOME: casa,
    DEV_IDE_HOME: path.join(casa, 'casa'),
    DEV_IDE_VAULT: path.join(casa, 'vault.json'),
    DEV_IDE_SESSION: path.join(casa, 'sessao.json'),
  },
});

let navegador;
try {
  let dePe = false;
  for (let i = 0; i < 100 && !dePe; i++) {
    try { await fetch(`${BASE}/api/connections/drivers`); dePe = true; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!dePe) throw new Error('o motor não subiu');

  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const pagina = await (await navegador.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));
  await pagina.goto(`${BASE}/?abrirPasta=${encodeURIComponent(pasta)}&abrirArquivo=${encodeURIComponent(arquivo)}`);
  const nbTela = pagina.locator('[data-notebook]');
  await nbTela.waitFor({ timeout: 30000 });

  const codigo = nbTela.locator('[data-celula="c1"]');
  const sql = nbTela.locator('[data-celula="s1"]');
  /** Roda a célula de código e devolve o texto das saídas quando ela termina. */
  const rodar = async () => {
    await codigo.getByRole('button', { name: /Rodar célula/ }).click();
    await pagina.waitForTimeout(200);
    for (let i = 0; i < 200 && /\[\*\]/.test(await codigo.innerText()); i++) await pagina.waitForTimeout(100);
    return codigo.locator('[data-saidas]').textContent().catch(() => '');
  };

  // ---- 1. a resposta guardada, sem rodar a célula HTTP ----
  const primeira = await rodar();
  marcar('a célula PHP usa a resposta HTTP guardada no arquivo, sem rodar a HTTP', /^10$/.test(primeira.trim()),
    JSON.stringify(primeira.slice(0, 160)));
  const aviso = sql.locator('[data-aviso-de-restauro]');
  await aviso.waitFor({ timeout: 5000 }).catch(() => undefined);
  marcar('o SQL grande demais para o arquivo avisa embaixo da célula que não voltou',
    /vendas não voltou com o kernel novo: o arquivo guarda só 1 de 900 linhas\. Rode esta célula de novo\./
      .test(await aviso.textContent().catch(() => '')),
    JSON.stringify(await aviso.textContent().catch(() => '')));

  // ---- 2. parado mais de um minuto: o kernel continua lá ----
  await pagina.waitForTimeout(PARADO_MS);
  const vivos = await (await fetch(`${BASE}/api/notebook/kernels?caminho=${encodeURIComponent(arquivo)}`)).json();
  marcar(`parado ${PARADO_MS / 1000} s, o kernel PHP continua vivo no motor`,
    vivos.data.some((k) => k.familia === 'php'), JSON.stringify(vivos.data.map((k) => k.familia)));
  const depois = await rodar();
  marcar('…e a célula roda nele, sem subir outro', depois.trim() === '10', JSON.stringify(depois.slice(0, 160)));

  // ---- 3. o kernel morto por fora: a célula sobe outro sozinha ----
  await fetch(`${BASE}/api/notebook/kernel/encerrar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caminho: arquivo, linguagem: 'php' }),
  });
  const reerguida = await rodar();
  marcar('kernel morto: um clique só — a célula diz que subiu outro e roda com a resposta guardada',
    /O kernel PHP tinha parado; subiu outro/.test(reerguida) && /10\s*$/.test(reerguida),
    JSON.stringify(reerguida.slice(0, 200)));

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
