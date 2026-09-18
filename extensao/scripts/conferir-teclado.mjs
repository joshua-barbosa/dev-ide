// Ctrl+C, Ctrl+X e Ctrl+V dentro da webview, com o hospedeiro reproduzido.
//
// Ele relatou, nos DOIS editores: *"o CTRL + C e CTRL + V e CTRL + X não está
// funcionando, principalmente nos .sqlbook, eu preciso apertar botão direito"*.
//
// O motivo não é nosso — é do hospedeiro. A webview do VS Code cancela as três
// teclas quando roda no Electron (`vs/workbench/contrib/webview/browser/pre/
// index.html`, `handleInnerKeydown`), contando que o editor faça o serviço
// depois; e o comando dele age no campo do workbench, não no nosso foco.
//
// Por isso esta guarda INSTALA o mesmo `preventDefault` antes de carregar a
// nossa página: sem isso ela passaria verde no Chrome puro, que é justamente
// onde o defeito não aparece. O gesto é a tecla de verdade, e a conferência é a
// área de transferência de verdade.
//
//   npm run conferir:teclado
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const WEB = path.resolve(process.argv[2] ?? path.join(RAIZ, 'extensao/webview'));
const BASE = 'http://127.0.0.1:4485';

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

/**
 * O trecho do VS Code, copiado do comportamento (não do código): as teclas de
 * copiar/recortar/colar chegam canceladas na nossa página.
 */
const HOSPEDEIRO = process.env.SEM_HOSPEDEIRO === '1' ? '' : `
  document.addEventListener('keydown', (e) => {
    const comMeta = e.ctrlKey || e.metaKey;
    const shiftInsert = e.shiftKey && e.keyCode === 45;
    if ((comMeta && [67, 86, 88].includes(e.keyCode)) || shiftInsert) e.preventDefault();
  });
`;

const CADERNO = JSON.stringify({
  versao: 1,
  celulas: [{ linguagem: 'sql', conteudo: 'SELECT 1;' }],
}, null, 2);

let navegador;
try {
  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const contexto = await navegador.newContext({ viewport: { width: 1100, height: 800 } });
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const pagina = await contexto.newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));
  if (process.env.DEPURAR === '1') {
    pagina.on('console', (m) => console.error('[console]', m.type(), m.text().slice(0, 200)));
    pagina.on('requestfailed', (r) => console.error('[falhou]', r.url().slice(0, 120)));
  }

  await pagina.route(`${BASE}/**`, async (rota) => {
    const nome = new URL(rota.request().url()).pathname.replace(/^\//, '');
    if (nome === 'pagina.html') {
      const config = {
        base: BASE, caminho: '/tmp/exemplo.sqlbook', titulo: 'exemplo.sqlbook',
        conteudo: CADERNO, tema: 'escuro', fontSize: 13, tabSize: 2,
        connectionId: null, database: null,
      };
      return rota.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{height:100%;margin:0}#raiz{height:100%}</style>
${existsSync(path.join(WEB, 'caderno.css')) ? '<link rel="stylesheet" href="caderno.css">' : ''}
</head><body class="vscode-dark"><div id="raiz"></div>
<script>${HOSPEDEIRO}</script>
<script>window.BRAYTECH=${JSON.stringify(config)};</script>
<script src="caderno.js"></script></body></html>`,
      });
    }
    const arquivo = path.join(WEB, nome);
    if (!existsSync(arquivo)) return rota.fulfill({ status: 404 });
    const tipo = nome.endsWith('.js') ? 'text/javascript'
      : nome.endsWith('.css') ? 'text/css' : undefined;
    return rota.fulfill({ body: readFileSync(arquivo), contentType: tipo });
  });

  await pagina.goto(`${BASE}/pagina.html`);

  // O Monaco só existe no bloco EM FOCO (`EditorDoBloco`): fora dele o bloco é
  // uma `textarea` com camada de cor. Clicar primeiro, esperar depois.
  await pagina.locator('[data-bloco]').first().click();
  await pagina.locator('.monaco-editor').first().waitFor({ timeout: 20000 });
  await pagina.waitForTimeout(400);

  const lerCelula = () => pagina.evaluate(() => {
    const linhas = document.querySelectorAll('.monaco-editor .view-line');
    return Array.from(linhas).map((l) => l.textContent).join('\n');
  });
  const areaDeTransferencia = () => pagina.evaluate(() => navigator.clipboard.readText());

  await pagina.keyboard.press('Control+A');
  await pagina.keyboard.type('SELECT teste_de_copia;');
  await pagina.keyboard.press('Control+A');

  await pagina.keyboard.press('Control+C');
  await pagina.waitForTimeout(250);
  const copiado = await areaDeTransferencia().catch(() => '');
  marcar('Ctrl+C copia a seleção do bloco', copiado.includes('teste_de_copia'),
    `área de transferência: ${JSON.stringify(copiado.slice(0, 40))}`);

  await pagina.keyboard.press('End');
  await pagina.keyboard.press('Control+V');
  await pagina.waitForTimeout(250);
  const depoisDeColar = await lerCelula();
  const vezes = depoisDeColar.split('teste_de_copia').length - 1;
  // EXATAMENTE duas: se colássemos por cima de um hospedeiro que também cola,
  // sairiam três — e é esse o risco de atender uma tecla que não é nossa.
  marcar('Ctrl+V cola no bloco, UMA vez', vezes === 2,
    `${vezes} ocorrência(s): ${JSON.stringify(depoisDeColar.slice(0, 60))}`);

  await pagina.keyboard.press('Control+A');
  await pagina.keyboard.press('Control+X');
  await pagina.waitForTimeout(250);
  const depoisDeRecortar = await lerCelula();
  const recortado = await areaDeTransferencia().catch(() => '');
  marcar('Ctrl+X recorta: tira do bloco e põe na área de transferência',
    depoisDeRecortar.trim() === '' && recortado.includes('teste_de_copia'),
    `sobrou: ${JSON.stringify(depoisDeRecortar.slice(0, 40))}`);

  // O campo comum (formulário, filtro da grade) não é Monaco e não atende o
  // evento: quem copia e cola ali somos nós, na mão.
  await pagina.evaluate(() => {
    const campo = document.createElement('input');
    campo.id = 'campo-comum';
    document.body.appendChild(campo);
    campo.focus();
  });
  const comum = pagina.locator('#campo-comum');
  await comum.fill('valor-do-campo');
  await comum.press('Control+A');
  await comum.press('Control+X');
  await pagina.waitForTimeout(250);
  const recortadoDoCampo = await areaDeTransferencia().catch(() => '');
  marcar('Ctrl+X recorta num campo comum',
    (await comum.inputValue()) === '' && recortadoDoCampo === 'valor-do-campo',
    `sobrou: ${JSON.stringify(await comum.inputValue())}`);

  await comum.press('Control+V');
  await pagina.waitForTimeout(250);
  marcar('Ctrl+V cola num campo comum', (await comum.inputValue()) === 'valor-do-campo',
    `valor: ${JSON.stringify(await comum.inputValue())}`);

  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0,
    errosDaPagina.slice(0, 2).join(' | '));
} catch (erro) {
  marcar('a verificação rodou até o fim', false, erro instanceof Error ? erro.message : String(erro));
} finally {
  await navegador?.close();
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
