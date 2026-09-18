// A lupa numa grade de RESULTADO: ela promete o valor inteiro, tem que entregar.
//
// Ele: *"os campos quando eu clico na lupa para ver o conteúdo não está trazendo
// o conteúdo inteiro, somente um pedaço, isso quebra o JSON inteiro de muitas
// tabelas e eu precisando ver eles"* — e, perguntado onde, respondeu: *"todas as
// telas de resultado que venha de banco de dados, o único mostrando certo é o
// Redis"*. O Redis mostrava certo porque o driver dele não passa pelo corte dos
// drivers SQL, que era feito ANTES de o valor sair do banco.
//
// Esta guarda vai do banco à tela: motor de verdade, SQLite descartável, a
// webview da extensão no Chrome, o clique na lupa e o texto do visor.
//
//   npm run conferir:lupa
import { chromium } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const WEB = path.resolve(process.argv[2] ?? path.join(RAIZ, 'extensao/webview'));
// `MOTOR` aponta para outro motor de propósito: é assim que se vê esta guarda
// FALHAR contra o código anterior, que cortava em 2048 dentro do driver.
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const PORTA = 4487;
const BASE = `http://127.0.0.1:${PORTA}`;
const SENHA = 'senha-de-teste-1234';
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-lupa-'));

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

/** Um JSON grande e VERIFICÁVEL: se vier cortado, a marca final some. */
const MARCA = 'MARCA-FINAL-DO-JSON';
function jsonDeProva(alternativas) {
  return JSON.stringify({
    questao: 1,
    enunciado: 'Enunciado de exemplo, inventado para o teste.',
    alternativas: Array.from({ length: alternativas }, (_, i) => `alternativa ${i} de exemplo`),
    fim: MARCA,
  });
}

const banco = path.join(casa, 'exemplo.db');
const db = new DatabaseSync(banco);
db.exec('CREATE TABLE provas (id INTEGER PRIMARY KEY, titulo TEXT, conteudo TEXT)');
const grande = jsonDeProva(400);
db.prepare('INSERT INTO provas (titulo, conteudo) VALUES (?, ?)').run('Prova de exemplo', grande);
db.close();

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

  await api('/api/connections/vault', { password: SENHA });
  const conexao = await api('/api/connections', {
    type: 'sqlite', label: 'exemplo', group: 'Exemplos', readOnly: false,
    fields: { file: banco },
  });

  const consulta = { statement: 'SELECT id, titulo, conteudo FROM provas', database: 'main' };
  const resultado = await api(`/api/connections/${conexao.id}/execute`, consulta);
  const doMotor = String(resultado.rows[0][2]);
  marcar('o motor devolve o valor INTEIRO, sem cortar em 2048',
    doMotor.length === grande.length && doMotor.endsWith(`${MARCA}"}`),
    `${doMotor.length} de ${grande.length} caracteres`);
  marcar('nada marcado como cortado quando cabe no orçamento',
    Object.keys(resultado.cortes ?? {}).length === 0, JSON.stringify(resultado.cortes));

  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const contexto = await navegador.newContext({ viewport: { width: 1200, height: 800 } });
  const pagina = await contexto.newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));

  const abrir = async (dados, orcamento) => {
    await pagina.route(`${BASE}/aba/**`, async (rota) => {
      const nome = new URL(rota.request().url()).pathname.replace('/aba/', '');
      if (nome === 'pagina.html') {
        const config = {
          base: BASE, tipo: 'resultado', titulo: 'Resultado', tema: 'escuro',
          fontSize: 13, tabSize: 2, dados,
        };
        return rota.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{height:100%;margin:0}#raiz{height:100%}</style>
${existsSync(path.join(WEB, 'aba.css')) ? '<link rel="stylesheet" href="aba.css">' : ''}
</head><body class="vscode-dark"><div id="raiz"></div>
<script>try{${orcamento === undefined
  ? "localStorage.removeItem('dev-ide.grade.orcamento')"
  : `localStorage.setItem('dev-ide.grade.orcamento','${orcamento}')`}}catch(e){}</script>
<script>window.BRAYTECH=${JSON.stringify(config)};</script>
<script src="aba.js"></script></body></html>`,
        });
      }
      const arquivo = path.join(WEB, nome);
      if (!existsSync(arquivo)) return rota.fulfill({ status: 404 });
      const tipo = nome.endsWith('.js') ? 'text/javascript'
        : nome.endsWith('.css') ? 'text/css' : undefined;
      return rota.fulfill({ body: readFileSync(arquivo), contentType: tipo });
    });
    await pagina.goto(`${BASE}/aba/pagina.html`);
    await pagina.locator('[data-grade-de-resultado]').waitFor({ timeout: 20000 });
  };

  /** Abre a lupa da célula do JSON e devolve o que o visor mostra. */
  const olharPelaLupa = async () => {
    const celula = pagina.locator('[data-celula-da-coluna="conteudo"]').first();
    await celula.hover();
    await celula.locator('button, [role=button]').first().click();
    const visor = pagina.locator('[data-visor-de-celula]');
    await visor.waitFor({ timeout: 10000 });
    await pagina.waitForTimeout(400);
    return {
      texto: await visor.innerText(),
      aviso: await visor.locator('[data-corte]').innerText().catch(() => ''),
    };
  };

  await abrir({ resultado, consulta: { ...consulta, connectionId: conexao.id } });
  const vista = await olharPelaLupa();
  marcar('a lupa mostra o JSON INTEIRO numa grade de resultado',
    vista.texto.includes(MARCA),
    `${vista.texto.length} caracteres no visor · ${vista.texto.includes(MARCA) ? 'com' : 'SEM'} a marca final`);
  marcar('sem corte, o visor não avisa corte nenhum', vista.aviso === '', vista.aviso);

  // ---- o outro lado: orçamento apertado, e o visor tem de DIZER ----
  const apertado = await api(`/api/connections/${conexao.id}/execute`, {
    ...consulta, orcamentoDeCelulas: 100,
  });
  marcar('com orçamento apertado o motor marca a célula cortada',
    apertado.cortes?.['0:2'] === grande.length, JSON.stringify(apertado.cortes));

  await abrir({ resultado: apertado, consulta: { ...consulta, connectionId: conexao.id } }, 100);
  const cortada = await olharPelaLupa();
  marcar('o visor diz DE QUANTO para quanto, em vez de mostrar a amostra calado',
    cortada.aviso.includes('de ') && cortada.aviso.includes(grande.length.toLocaleString('pt-BR')),
    JSON.stringify(cortada.aviso.slice(0, 120)));

  // ---- o ajuste, pelo painel de aparência: o gesto dele, não a chave ----
  await pagina.keyboard.press('Escape');
  await pagina.getByRole('button', { name: /aparência/i }).first().click();
  const painel = pagina.locator('[data-painel-de-aparencia]');
  await painel.waitFor({ timeout: 5000 });
  const temControle = await painel.getByText('Valores grandes').first().isVisible();
  marcar('o painel de aparência tem o ajuste de valores grandes', temControle);
  await painel.getByRole('radio', { name: '32 MB' }).click();
  await pagina.waitForTimeout(200);
  const guardado = await pagina.evaluate(() => localStorage.getItem('dev-ide.grade.orcamento'));
  marcar('escolher 32 MB no painel muda o orçamento das próximas consultas',
    guardado === String(32 * 1024 * 1024), String(guardado));

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
