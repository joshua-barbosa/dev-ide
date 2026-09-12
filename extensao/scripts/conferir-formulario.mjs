// O formulário da extensão numa máquina NOVA, com o gesto de verdade.
//
// Ele instalou a extensão num notebook sem a IDE, preencheu uma conexão e
// clicou Salvar: nada. Nenhum erro, nada gravado, e o cofre não existia. O
// `conferir:extensao` não alcança isso — ele roda o host em Node, e o defeito
// morava na WEBVIEW, que só um navegador executa.
//
// Sobe o motor EMPACOTADO (o do `.vsix`) numa casa vazia, carrega o
// `formulario.js` da extensão, preenche uma conexão SQLite e clica Salvar.
//
//   npm run conferir:formulario            (usa extensao/webview)
//   node extensao/scripts/conferir-formulario.mjs <pasta-da-webview>
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const WEB = path.resolve(process.argv[2] ?? path.join(RAIZ, 'extensao/webview'));
const MOTOR = path.join(RAIZ, 'extensao/motor/servidor.js');
const PORTA = 4483;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-maquina-nova-'));

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

if (!existsSync(MOTOR)) {
  console.error('Falta o motor empacotado. Rode `npm run build:extensao` antes.');
  process.exit(1);
}

const motor = spawn(
  process.execPath,
  ['-e', `require(${JSON.stringify(MOTOR)}).iniciarServidor(${PORTA})`],
  {
    stdio: 'ignore',
    // `DEV_IDE_HOME` VAZIO de propósito: com `??` ele virava caminho relativo e
    // o cofre ia parar na pasta de onde o motor subiu.
    env: { ...process.env, HOME: casa, USERPROFILE: casa, DEV_IDE_HOME: '', DEV_IDE_VAULT: '' },
    cwd: tmpdir(),
  }
);
const api = (r) => fetch(`http://127.0.0.1:${PORTA}${r}`).then((x) => x.json()).then((x) => x.data);

let navegador;
try {
  let de_pe = false;
  for (let i = 0; i < 100 && !de_pe; i++) {
    try { await api('/api/connections/drivers'); de_pe = true; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!de_pe) throw new Error('o motor empacotado não subiu');

  // O Chrome do sistema, se houver; senão o Chromium do Playwright.
  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const pagina = await (await navegador.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));

  // A página vem "do" motor: mesma origem, sem CORS — como a ponte faz dentro
  // do editor, onde quem fala com o motor é o host.
  await pagina.route(`http://127.0.0.1:${PORTA}/form/**`, async (rota) => {
    const nome = new URL(rota.request().url()).pathname.replace('/form/', '');
    if (nome === 'pagina.html') {
      const config = { base: `http://127.0.0.1:${PORTA}`, conexaoId: null, grupo: '' };
      return rota.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{height:100%;margin:0}#raiz{height:100%;display:flex;flex-direction:column}#raiz>*{flex:1 1 auto;min-height:0}</style>
${existsSync(path.join(WEB, 'formulario.css')) ? '<link rel="stylesheet" href="formulario.css">' : ''}
</head><body class="vscode-dark"><div id="raiz"></div>
<script>window.BRAYTECH=${JSON.stringify(config)};</script>
<script src="formulario.js"></script></body></html>`,
      });
    }
    const arquivo = path.join(WEB, nome);
    if (!existsSync(arquivo)) return rota.fulfill({ status: 404 });
    const tipo = nome.endsWith('.js') ? 'text/javascript' : nome.endsWith('.css') ? 'text/css' : undefined;
    return rota.fulfill({ body: readFileSync(arquivo), contentType: tipo });
  });

  await pagina.goto(`http://127.0.0.1:${PORTA}/form/pagina.html`);
  await pagina.getByRole('button', { name: 'SQLite', exact: true }).click({ timeout: 15000 });
  await pagina.getByLabel('Nome').fill('exemplo');
  await pagina.getByLabel(/arquivo/i).first().fill(path.join(casa, 'exemplo.db'));

  const antes = (await api('/api/connections')).vault;
  marcar('a máquina começa SEM cofre', antes.exists === false, JSON.stringify(antes));

  await pagina.getByRole('button', { name: /^salvar$/i }).first().click();
  const dialogo = pagina.getByRole('dialog');
  const apareceu = await dialogo.waitFor({ timeout: 5000 }).then(() => true, () => false);
  marcar('Salvar sem cofre PEDE a senha, em vez de travar calado', apareceu);

  if (apareceu) {
    const senhas = dialogo.locator('input[type=password]');
    for (let i = 0; i < (await senhas.count()); i++) await senhas.nth(i).fill('senha-nova-1234');
    await dialogo.getByRole('button', { name: /criar/i }).click();
    await dialogo.waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
  }

  // A gravação acontece depois do diálogo fechar: dá um instante ao motor.
  let depois = await api('/api/connections');
  for (let i = 0; i < 20 && !JSON.stringify(depois.tree).includes('"exemplo"'); i++) {
    await new Promise((r) => setTimeout(r, 250));
    depois = await api('/api/connections');
  }
  marcar('o cofre foi criado e ficou aberto',
    depois.vault.exists === true && depois.vault.unlocked === true, JSON.stringify(depois.vault));
  marcar('a conexão foi gravada', JSON.stringify(depois.tree).includes('"label":"exemplo"'));

  const pastaDeDados = path.join(casa, '.dev-ide');
  const arquivos = existsSync(pastaDeDados) ? readdirSync(pastaDeDados) : [];
  marcar('o cofre está em ~/.dev-ide, não relativo à pasta de onde o motor subiu',
    arquivos.includes('vault.json'), `~/.dev-ide: [${arquivos.join(', ')}]`);
  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0, errosDaPagina.slice(0, 2).join(' | '));
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
