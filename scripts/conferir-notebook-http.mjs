// A célula HTTP do notebook usada de verdade, na IDE (spec 120, etapa 1).
//
// O gesto dele do começo ao fim: "+ HTTP", método, URL com query (a aba Params
// acompanha), corpo raw JSON, rodar, ver a resposta; uma segunda célula com
// `Bearer {{login.body.token}}`; o Python lendo a resposta; form-data com
// arquivo, binary, Preview de HTML sem scripts, imagem e "Salvar"; gravar e
// reabrir com a resposta guardada. Etapa 2: Authorization com o token no
// cofre e só a referência no `.brnb`. Etapa 3: colar cURL na URL, copiar como
// cURL, timeout da aba Settings, e cookies de uma célula para a outra. Etapa 4:
// "para cada item" — tabela, lista no Python, progresso e Parar. Etapa 5:
// OAuth 2.0 — Client Credentials sozinho, e o login do Authorization Code numa
// janela de verdade, com PKCE conferido pelo provedor de mentira.
//
// Motor de verdade, uma API de mentira nesta máquina, a IDE no Chrome.
//
//   npm run build && npm run conferir:notebook-http
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const PORTA = 4504;
const BASE = `http://127.0.0.1:${PORTA}`;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-notebook-http-'));
const pasta = path.join(casa, 'projeto');
mkdirSync(pasta);
const arquivo = path.join(pasta, 'api.brnb');
writeFileSync(arquivo, '');
const anexo = path.join(casa, 'anexo.txt');
writeFileSync(anexo, 'conteúdo do anexo');
const binario = path.join(casa, 'dados.bin');
writeFileSync(binario, Buffer.from([0, 1, 2, 3, 254, 255]));
// Um PNG de 1×1 de verdade: o navegador precisa conseguir desenhá-lo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'
);

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

// ---- a API de mentira ----
const recebidos = [];
const desafios = new Map();
const tokensOAuth = new Set();
const api = createServer((req, res) => {
  const pedacos = [];
  req.on('data', (p) => pedacos.push(p));
  req.on('end', () => {
    const corpo = Buffer.concat(pedacos);
    recebidos.push({ metodo: req.method, url: req.url, headers: req.headers, corpo });
    const rota = (req.url ?? '').split('?')[0];
    const consulta = new URL(req.url ?? '/', 'http://x').searchParams;
    if (rota === '/oauth/authorize') {
      // O "login" do provedor: guarda o desafio PKCE e volta com o código.
      const codigo = `cod-${recebidos.length}`;
      desafios.set(codigo, consulta.get('code_challenge') ?? '');
      const volta = new URL(consulta.get('redirect_uri') ?? '');
      volta.searchParams.set('code', codigo);
      volta.searchParams.set('state', consulta.get('state') ?? '');
      res.writeHead(302, { location: volta.toString() });
      res.end();
      return;
    }
    if (rota === '/oauth/token') {
      const f = Object.fromEntries(new URLSearchParams(corpo.toString()));
      const clienteOk = req.headers.authorization === `Basic ${Buffer.from('app:segredo').toString('base64')}`;
      const pkceOk = f.grant_type !== 'authorization_code'
        || desafios.get(f.code ?? '') === createHash('sha256').update(f.code_verifier ?? '').digest('base64url');
      if (!clienteOk || !pkceOk) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: clienteOk ? 'PKCE não confere' : 'client errado' }));
        return;
      }
      const acesso = `tk-oauth-${f.grant_type}-${recebidos.length}`;
      tokensOAuth.add(acesso);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: acesso, token_type: 'Bearer', expires_in: 3600, refresh_token: `r-${recebidos.length}` }));
      return;
    }
    if (rota === '/protegida') {
      const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      res.writeHead(tokensOAuth.has(t) ? 200 : 401, { 'content-type': 'text/plain' });
      res.end(tokensOAuth.has(t) ? `ok com ${t}` : 'sem token');
      return;
    }
    if (rota === '/login') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: 'tk-123', usuario: { nome: 'Ana' } }));
    } else if (rota === '/eu') {
      res.writeHead(req.headers.authorization === 'Bearer tk-123' ? 200 : 401, { 'content-type': 'text/plain' });
      res.end(req.headers.authorization === 'Bearer tk-123' ? 'é você' : 'quem é você?');
    } else if (rota.startsWith('/pedido/')) {
      const id = rota.split('/')[2];
      setTimeout(() => {
        if (id === '404') {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('não existe');
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: Number(id), status: 'ok' }));
        }
      }, req.headers['x-devagar'] === 'sim' ? 200 : 0);
      return;
    } else if (rota === '/lento') {
      setTimeout(() => res.end('tarde'), 3000);
      return;
    } else if (rota === '/entrar') {
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'sessao=s9; Path=/' });
      res.end('entrou');
    } else if (rota === '/quem') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`cookie: ${req.headers.cookie ?? '(nenhum)'}`);
    } else if (rota === '/pagina') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Página da API</h1><script>document.body.dataset.rodou = "sim"</script></body></html>');
    } else if (rota === '/foto.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tipo: req.headers['content-type'] ?? null, bytes: corpo.length }));
    }
  });
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${api.address().port}`;
// Uma porta livre para a volta do login do OAuth.
const PORTA_DE_RETORNO = await new Promise((resolver) => {
  const livre = createServer();
  livre.listen(0, '127.0.0.1', () => {
    const porta = livre.address().port;
    livre.close(() => resolver(porta));
  });
});
const ultimo = () => recebidos[recebidos.length - 1];

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
  let de_pe = false;
  for (let i = 0; i < 100 && !de_pe; i++) {
    try { await fetch(`${BASE}/api/connections/drivers`); de_pe = true; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!de_pe) throw new Error('o motor não subiu');

  navegador = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const contexto = await navegador.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const pagina = await contexto.newPage();
  const errosDaPagina = [];
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));
  const url = `${BASE}/?abrirPasta=${encodeURIComponent(pasta)}&abrirArquivo=${encodeURIComponent(arquivo)}`;
  await pagina.goto(url);

  const escolha = pagina.locator('[data-notebook-escolher-kernel]');
  await escolha.waitFor({ timeout: 30000 });
  await escolha.getByRole('button', { name: 'Python' }).click();
  const nb = pagina.locator('[data-notebook]');
  await nb.waitFor({ timeout: 10000 });

  /** Espera a célula terminar (o `[*]` some) e devolve o texto das saídas. */
  const saidaDe = async (celula, prazo = 20000) => {
    const inicio = Date.now();
    await pagina.waitForTimeout(150);
    while (/\[\*\]/.test(await celula.innerText()) && Date.now() - inicio < prazo) {
      await pagina.waitForTimeout(100);
    }
    // O corpo colorido recua com espaço não separável: normalizado para comparar.
    return (await celula.locator('[data-saidas]').textContent().catch(() => '')).replace(/\u00a0/g, ' ');
  };
  const novaHttp = async (posicao) => {
    await nb.locator(`[data-adicionar="${posicao}"]`).getByRole('button', { name: 'HTTP' }).click();
    return nb.locator('[data-celula]').nth(posicao);
  };
  const nomear = (celula, nome) => celula.getByRole('textbox', { name: 'Nome do resultado' }).fill(nome);

  // ---- 1. login: POST, query, raw JSON ----
  const login = await novaHttp(1);
  marcar('"+ HTTP" cria uma célula HTTP com o formulário', await login.locator('[data-formulario-http]').isVisible());
  await nomear(login, 'login');
  await login.getByRole('combobox', { name: 'Método HTTP' }).selectOption('POST');
  const campoUrl = login.getByRole('textbox', { name: 'URL da requisição' });
  await campoUrl.fill(`${API}/login?origem=guarda&lixo=1`);
  const params = login.getByRole('table', { name: 'Params' });
  marcar('escrever ?origem=guarda na URL aparece na aba Params',
    (await params.getByRole('textbox', { name: 'Params: chave da linha 1' }).inputValue()) === 'origem');
  await params.getByRole('checkbox', { name: 'Params: mandar a linha 2' }).uncheck();
  marcar('desmarcar a linha tira o parâmetro da URL',
    (await campoUrl.inputValue()) === `${API}/login?origem=guarda`, await campoUrl.inputValue());

  await login.getByRole('tab', { name: /Body/ }).click();
  await login.locator('label', { hasText: /^raw$/ }).click();
  await login.getByRole('combobox', { name: 'Formato do raw' }).selectOption('json');
  await login.getByRole('textbox', { name: 'Corpo da requisição' }).click();
  await login.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  // insertText: o Monaco fecharia as chaves e aspas digitadas uma a uma.
  await pagina.keyboard.insertText('{"usuario": "ana"}');
  await campoUrl.click();
  await campoUrl.press('Enter');
  const saidaLogin = await saidaDe(login);
  const status = login.locator('[data-status-http]');
  marcar('Enter na URL roda: 200 OK embaixo da célula', (await status.textContent().catch(() => '')) === '200 OK',
    JSON.stringify(saidaLogin.slice(0, 120)));
  const chegou = recebidos.find((r) => r.url?.startsWith('/login'));
  marcar('a API recebeu POST, a query ligada e o corpo JSON com Content-Type certo',
    chegou?.metodo === 'POST' && chegou.url === '/login?origem=guarda'
      && chegou.headers['content-type'] === 'application/json' && chegou.corpo.toString() === '{"usuario": "ana"}',
    JSON.stringify({ metodo: chegou?.metodo, url: chegou?.url, tipo: chegou?.headers['content-type'], corpo: chegou?.corpo.toString() }));
  // innerText: as quebras de linha do colorizador; ele recua com espaço não separável.
  const pretty = (await login.locator('[data-corpo-http]').innerText()).replace(/\u00a0/g, ' ');
  marcar('Pretty mostra o JSON indentado, uma chave por linha', /^\{\n {2}"token": "tk-123",\n {2}"usuario": \{\n {4}"nome"/.test(pretty),
    JSON.stringify(pretty.slice(0, 80)));
  marcar('a célula anuncia a variável', /→ login: \{ status, headers, body, tempo \}/.test(saidaLogin));

  // ---- 2. o token de uma célula na outra ----
  const eu = await novaHttp(2);
  await nomear(eu, 'eu');
  await eu.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/eu`);
  await eu.getByRole('tab', { name: /Headers/ }).click();
  const headers = eu.getByRole('table', { name: 'Headers' });
  await headers.getByRole('textbox', { name: 'Headers: chave da linha 1' }).fill('Authorization');
  await headers.getByRole('textbox', { name: 'Headers: valor da linha 1' }).fill('Bearer {{login.body.token}}');
  await eu.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(eu);
  marcar('{{login.body.token}} no header: a API recebeu "Bearer tk-123"',
    ultimo()?.headers.authorization === 'Bearer tk-123', JSON.stringify(ultimo()?.headers.authorization));
  marcar('…e respondeu 200', (await eu.locator('[data-status-http]').textContent().catch(() => '')) === '200 OK');

  // ---- 3. o Python lê as respostas ----
  await nb.locator('[data-adicionar="3"]').getByRole('button', { name: 'Python' }).click();
  const py = nb.locator('[data-celula]').nth(3);
  await py.locator('textarea').first().click();
  await py.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.keyboard.insertText("print(login['body']['usuario']['nome'], eu['status'], eu['body'])");
  await py.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaPy = await saidaDe(py, 30000);
  marcar('a célula Python lê a resposta: body já como dicionário', saidaPy.includes('Ana 200 é você'), JSON.stringify(saidaPy.slice(0, 120)));

  // ---- 4. form-data com arquivo; depois binary ----
  const envio = await novaHttp(4);
  await envio.getByRole('combobox', { name: 'Método HTTP' }).selectOption('POST');
  await envio.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/eco`);
  await envio.getByRole('tab', { name: /Body/ }).click();
  await envio.locator('label', { hasText: /^form-data$/ }).click();
  const form = envio.getByRole('table', { name: 'form-data' });
  await form.getByRole('textbox', { name: 'form-data: chave da linha 1' }).fill('anexo');
  await form.getByRole('combobox', { name: 'Tipo do campo anexo' }).selectOption('arquivo');
  await form.getByRole('textbox', { name: 'form-data: valor da linha 1' }).fill(anexo);
  await form.getByRole('textbox', { name: 'form-data: chave da linha 2' }).fill('campo');
  await form.getByRole('textbox', { name: 'form-data: valor da linha 2' }).fill('valor');
  await envio.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(envio);
  const multipart = ultimo()?.corpo.toString() ?? '';
  marcar('form-data: o arquivo (pelo caminho) e o campo de texto chegam em multipart',
    /^multipart\/form-data; boundary=/.test(ultimo()?.headers['content-type'] ?? '')
      && multipart.includes('filename="anexo.txt"') && multipart.includes('conteúdo do anexo') && multipart.includes('name="campo"'),
    JSON.stringify(ultimo()?.headers['content-type']));

  await envio.locator('label', { hasText: /^binary$/ }).click();
  await envio.getByRole('textbox', { name: 'Arquivo do corpo (binary)' }).fill(binario);
  await envio.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(envio);
  marcar('binary: o arquivo byte a byte, application/octet-stream',
    ultimo()?.headers['content-type'] === 'application/octet-stream'
      && Buffer.compare(ultimo()?.corpo ?? Buffer.alloc(0), readFileSync(binario)) === 0);

  // ---- 5. HTML: Preview SEM scripts ----
  const html = await novaHttp(5);
  await html.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/pagina`);
  await html.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(html);
  await html.getByRole('tab', { name: 'Preview' }).click();
  const quadro = html.locator('[data-preview-http]');
  await quadro.waitFor({ timeout: 5000 });
  const dentro = quadro.contentFrame();
  const titulo = await dentro.locator('h1').textContent({ timeout: 5000 }).catch(() => '');
  const rodou = await dentro.locator('body').getAttribute('data-rodou').catch(() => 'erro');
  marcar('Preview desenha o HTML que voltou', titulo === 'Página da API', JSON.stringify(titulo));
  marcar('…e o script da página NÃO roda (iframe sem scripts)', rodou === null, JSON.stringify(rodou));
  await html.getByRole('tab', { name: /Headers \(/ }).click();
  marcar('a aba Headers da resposta mostra o content-type',
    (await html.getByRole('table', { name: 'Headers da resposta' }).textContent()).includes('text/html'));

  // ---- 6. imagem: aparece e "Salvar" grava ----
  const foto = await novaHttp(6);
  await foto.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/foto.png`);
  await foto.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(foto);
  const img = foto.locator('img[data-corpo-http]');
  const desenhou = await img.waitFor({ timeout: 5000 }).then(() => img.evaluate((i) => i.complete && i.naturalWidth === 1), () => false);
  marcar('resposta PNG aparece como imagem', desenhou);
  const [baixado] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    foto.getByRole('button', { name: 'Salvar a resposta em disco' }).click(),
  ]);
  const destino = path.join(casa, 'salvo.png');
  if (baixado !== null) await baixado.saveAs(destino);
  marcar('"Salvar" grava o corpo com o nome do fim da URL, byte a byte',
    baixado?.suggestedFilename() === 'foto.png' && Buffer.compare(readFileSync(destino), PNG) === 0,
    JSON.stringify(baixado?.suggestedFilename()));

  // ---- 7. gravar e reabrir ----
  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  let gravado = null;
  try { gravado = JSON.parse(readFileSync(arquivo, 'utf8')); } catch { /* fica null */ }
  const celulaLogin = gravado?.celulas?.find((c) => c.nome === 'login');
  marcar('Ctrl+S grava a versão 3 com a requisição e a resposta',
    gravado?.versao === 3 && celulaLogin?.tipo === 'http' && celulaLogin.http?.metodo === 'POST'
      && celulaLogin.http.params.length === 2 && celulaLogin.saidas?.[0]?.tipo === 'http',
    JSON.stringify({ versao: gravado?.versao, tipo: celulaLogin?.tipo, params: celulaLogin?.http?.params?.length }));
  marcar('o .brnb não guarda o token digitado em lugar nenhum além da resposta',
    !JSON.stringify(gravado?.celulas?.map((c) => c.http)).includes('tk-123'));

  await pagina.goto(url);
  await pagina.locator('[data-notebook]').waitFor({ timeout: 30000 });
  const reaberto = pagina.locator('[data-celula]').nth(1);
  marcar('reabrir mostra a requisição e a resposta guardada, sem rodar de novo',
    (await reaberto.getByRole('textbox', { name: 'URL da requisição' }).inputValue()) === `${API}/login?origem=guarda`
      && (await reaberto.locator('[data-status-http]').textContent({ timeout: 10000 }).catch(() => '')) === '200 OK');
  if (process.env.CAPTURA) await pagina.screenshot({ path: process.env.CAPTURA, fullPage: true });

  // ---- 8. "Rodar tudo" passa pelas células HTTP ----
  const antes = recebidos.length;
  await pagina.locator('[data-notebook]').getByRole('button', { name: 'Rodar tudo' }).click();
  await saidaDe(pagina.locator('[data-celula]').nth(6), 40000);
  marcar('"Rodar tudo" leva o token do login até a célula seguinte, de novo',
    recebidos.slice(antes).some((r) => r.url === '/eu' && r.headers.authorization === 'Bearer tk-123'),
    `${recebidos.length - antes} requisições`);

  // ---- 9. etapa 2: Authorization com o cofre ----
  await pagina.locator('[data-notebook] [data-adicionar="7"]').getByRole('button', { name: 'HTTP' }).click();
  const auth = pagina.locator('[data-celula]').nth(7);
  await auth.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/eu`);
  await auth.getByRole('tab', { name: /Authorization/ }).click();
  await auth.getByRole('combobox', { name: 'Tipo de autorização' }).selectOption('bearer');
  const token = auth.getByLabel('Token', { exact: true });
  marcar('o campo do token é de senha (não aparece na tela)', (await token.getAttribute('type')) === 'password');
  await token.pressSequentially('tk-123');
  // ▷ logo depois da última tecla: o valor ainda pode estar a caminho do cofre.
  await auth.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(auth);
  marcar('Bearer da aba Authorization: a API recebeu "Bearer tk-123"',
    ultimo()?.url === '/eu' && ultimo()?.headers.authorization === 'Bearer tk-123', JSON.stringify(ultimo()?.headers.authorization));

  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  const textoDoNb = readFileSync(arquivo, 'utf8');
  const celulaAuth = JSON.parse(textoDoNb).celulas[7];
  const ref = celulaAuth?.http?.autorizacao?.token?.cofre ?? '';
  marcar('o .brnb guarda só a REFERÊNCIA do cofre, não o token',
    /^http-[0-9a-f]{32}$/.test(ref) && !JSON.stringify(celulaAuth.http).includes('tk-123'), JSON.stringify(celulaAuth?.http?.autorizacao));
  const cofre = readFileSync(path.join(casa, 'vault.json'), 'utf8');
  marcar('o token está no cofre, CIFRADO', cofre.includes(ref) && !cofre.includes('tk-123'));

  await pagina.goto(url);
  await pagina.locator('[data-notebook]').waitFor({ timeout: 30000 });
  const auth2 = pagina.locator('[data-celula]').nth(7);
  await auth2.getByRole('tab', { name: /Authorization/ }).click();
  const token2 = auth2.getByLabel('Token', { exact: true });
  await pagina.waitForTimeout(500);
  marcar('reaberto, o campo diz "guardado no cofre", vazio na tela',
    (await token2.getAttribute('data-no-cofre')) === 'sim' && (await token2.inputValue()) === ''
      && /guardado no cofre/.test((await token2.getAttribute('placeholder')) ?? ''));
  await auth2.getByRole('button', { name: 'Mostrar Token' }).click();
  await pagina.waitForTimeout(300);
  marcar('o olho mostra o valor guardado', (await token2.inputValue()) === 'tk-123' && (await token2.getAttribute('type')) === 'text');
  await auth2.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(auth2);
  marcar('reaberto, a requisição sai com o token do cofre', ultimo()?.headers.authorization === 'Bearer tk-123');

  // API Key na query, na mesma célula.
  await auth2.getByRole('combobox', { name: 'Tipo de autorização' }).selectOption('apikey');
  await auth2.getByRole('textbox', { name: 'Key' }).fill('chave');
  await auth2.getByLabel('Value', { exact: true }).pressSequentially('k1');
  await auth2.getByRole('combobox', { name: 'Onde vai a API Key' }).selectOption('query');
  await auth2.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(auth2);
  marcar('API Key em Query Params: vai na URL', ultimo()?.url === '/eu?chave=k1', JSON.stringify(ultimo()?.url));

  // "Outra máquina": o .brnb com uma referência que este cofre não tem.
  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  const deOutra = JSON.parse(readFileSync(arquivo, 'utf8'));
  deOutra.celulas[7].http.autorizacao = { tipo: 'bearer', token: { cofre: 'http-de0outra0maquina' } };
  writeFileSync(arquivo, JSON.stringify(deOutra));
  await pagina.goto(url);
  await pagina.locator('[data-notebook]').waitFor({ timeout: 30000 });
  const auth3 = pagina.locator('[data-celula]').nth(7);
  await auth3.getByRole('tab', { name: /Authorization/ }).click();
  await pagina.waitForTimeout(500);
  marcar('notebook de outra máquina: o campo avisa que o token não está aqui',
    (await auth3.getByLabel('Token', { exact: true }).getAttribute('data-no-cofre')) === 'faltando'
      && /não está no cofre deste computador/.test(await auth3.innerText()));
  const antesDoErro = recebidos.length;
  await auth3.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaFalta = await saidaDe(auth3);
  marcar('…e rodar dá o recado do que fazer, sem mandar nada',
    /não está neste computador. Digite de novo na aba Authorization/.test(saidaFalta) && recebidos.length === antesDoErro,
    JSON.stringify(saidaFalta.slice(0, 120)));

  // ---- 10. etapa 3: cURL, Settings e cookies ----
  const area = (texto) => pagina.evaluate((t) => navigator.clipboard.writeText(t), texto);
  await pagina.locator('[data-notebook] [data-adicionar="8"]').getByRole('button', { name: 'HTTP' }).click();
  const doCurl = pagina.locator('[data-celula]').nth(8);
  await area(`curl -X POST '${API}/eco' -H 'X-Veio: do-curl' -H 'Authorization: Bearer tk-curl' --data-raw '{"a":1}' -H 'Content-Type: application/json'`);
  await doCurl.getByRole('textbox', { name: 'URL da requisição' }).click();
  await pagina.keyboard.press('Control+v');
  await pagina.waitForTimeout(300);
  marcar('colar um cURL na URL monta a célula inteira',
    (await doCurl.getByRole('textbox', { name: 'URL da requisição' }).inputValue()) === `${API}/eco`
      && (await doCurl.getByRole('combobox', { name: 'Método HTTP' }).inputValue()) === 'POST'
      && /cURL importado/.test(await doCurl.locator('[data-recado-curl]').textContent()));
  await doCurl.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(doCurl);
  marcar('o importado sai igual: header, Bearer (agora do cofre) e corpo JSON',
    ultimo()?.headers['x-veio'] === 'do-curl' && ultimo()?.headers.authorization === 'Bearer tk-curl'
      && ultimo()?.corpo.toString() === '{"a":1}', JSON.stringify(ultimo()?.headers.authorization));
  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  const celulaCurl = JSON.parse(readFileSync(arquivo, 'utf8')).celulas[8];
  marcar('o Bearer do cURL foi para o cofre, não para o .brnb',
    /^http-/.test(celulaCurl?.http?.autorizacao?.token?.cofre ?? '') && !JSON.stringify(celulaCurl.http).includes('tk-curl'));

  await doCurl.getByRole('button', { name: 'Copiar cURL (bash)' }).click();
  await pagina.waitForTimeout(400);
  const copiado = await pagina.evaluate(() => navigator.clipboard.readText());
  marcar('"Copiar cURL (bash)" põe o comando na área de transferência, com o token do cofre',
    copiado.startsWith(`curl -X POST '${API}/eco'`) && copiado.includes("-H 'Authorization: Bearer tk-curl'"), JSON.stringify(copiado.slice(0, 80)));
  await doCurl.getByRole('button', { name: 'Copiar cURL (cmd)' }).click();
  await pagina.waitForTimeout(400);
  const copiadoCmd = await pagina.evaluate(() => navigator.clipboard.readText());
  marcar('"Copiar cURL (cmd)" sai no formato do Chrome para o Windows (^"…^")', copiadoCmd.startsWith(`curl -X POST ^"${API}/eco^" ^`),
    JSON.stringify(copiadoCmd.slice(0, 60)));

  // Timeout pela aba Settings.
  await doCurl.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/lento`);
  await doCurl.getByRole('tab', { name: 'Settings' }).click();
  await doCurl.getByRole('spinbutton', { name: 'Timeout em milissegundos' }).fill('400');
  const antesDoTimeout = Date.now();
  await doCurl.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaTimeout = await saidaDe(doCurl);
  marcar('timeout de 400 ms na aba Settings: erro "Tempo esgotado" logo', /Tempo esgotado \(400 ms\)/.test(saidaTimeout)
    && Date.now() - antesDoTimeout < 2500, JSON.stringify(saidaTimeout.slice(0, 100)));

  // Cookies: uma célula entra, a seguinte manda a sessão.
  await doCurl.getByRole('spinbutton', { name: 'Timeout em milissegundos' }).fill('0');
  await doCurl.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/entrar`);
  await doCurl.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(doCurl);
  await pagina.locator('[data-notebook] [data-adicionar="9"]').getByRole('button', { name: 'HTTP' }).click();
  const quem = pagina.locator('[data-celula]').nth(9);
  await quem.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/quem`);
  await quem.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaQuem = await saidaDe(quem);
  marcar('o cookie que uma célula recebeu vai na seguinte', saidaQuem.includes('cookie: sessao=s9'), JSON.stringify(saidaQuem.slice(0, 120)));
  await pagina.locator('[data-notebook]').getByRole('button', { name: 'Cookies' }).click();
  const dialogo = pagina.getByRole('dialog').last();
  await dialogo.waitFor({ timeout: 5000 });
  marcar('o botão Cookies lista o que foi guardado', (await dialogo.innerText()).includes('sessao=s9'));
  await dialogo.getByText('Limpar todos os cookies deste notebook').click();
  await pagina.waitForTimeout(300);
  await quem.getByRole('button', { name: /Rodar célula/ }).click();
  const depoisDeLimpar = await saidaDe(quem, 20000);
  marcar('…e "Limpar" esvazia: a próxima vai sem cookie', depoisDeLimpar.includes('cookie: (nenhum)'), JSON.stringify(depoisDeLimpar.slice(0, 120)));

  // ---- 11. etapa 4: "para cada item" ----
  await pagina.locator('[data-notebook] [data-adicionar="10"]').getByRole('button', { name: 'Python' }).click();
  const lista = pagina.locator('[data-celula]').nth(10);
  await lista.locator('textarea').first().click();
  await lista.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.keyboard.insertText("pedidos = [{'id': 7}, {'id': 404}, {'id': 9}]\nmuitos = list(range(1, 40))");
  await lista.getByRole('button', { name: /Rodar célula/ }).click();
  await saidaDe(lista, 30000);
  await pagina.locator('[data-notebook] [data-adicionar="11"]').getByRole('button', { name: 'HTTP' }).click();
  const cada = pagina.locator('[data-celula]').nth(11);
  await nomear(cada, 'detalhes');
  await cada.getByRole('textbox', { name: 'Para cada item da lista' }).fill('pedidos');
  await cada.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/pedido/{{item.id}}`);
  await cada.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaCada = await saidaDe(cada, 30000);
  const tabelaCada = await cada.locator('[data-saida="tabela"]').textContent().catch(() => '');
  marcar('para cada: uma requisição por item, numa tabela (item, status, body)',
    /item.*status.*tempo.*tamanho.*body/s.test(tabelaCada) && tabelaCada.includes('404') && tabelaCada.includes('não existe'),
    JSON.stringify(tabelaCada.slice(0, 120)));
  marcar('…o resumo conta o 404 sem parar o laço, e a variável vira a lista',
    /para cada pedidos: 3 de 3 requisição\(ões\) · 1 com status de erro/.test(saidaCada) && /→ detalhes: lista com 3 resposta/.test(saidaCada),
    JSON.stringify(saidaCada.slice(-160)));

  await pagina.locator('[data-notebook] [data-adicionar="12"]').getByRole('button', { name: 'Python' }).click();
  const usaLista = pagina.locator('[data-celula]').nth(12);
  await usaLista.locator('textarea').first().click();
  await usaLista.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
  await pagina.keyboard.insertText("print([(d['item']['id'], d['status']) for d in detalhes])");
  await usaLista.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaUsa = await saidaDe(usaLista, 30000);
  marcar('o Python lê a lista: cada resposta com o item que a gerou', saidaUsa.includes('[(7, 200), (404, 404), (9, 200)]'),
    JSON.stringify(saidaUsa.slice(0, 120)));

  // Progresso e Parar.
  await cada.getByRole('textbox', { name: 'Para cada item da lista' }).fill('muitos');
  await cada.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/pedido/{{item}}`);
  await cada.getByRole('tab', { name: /Headers/ }).click();
  const hCada = cada.getByRole('table', { name: 'Headers' });
  await hCada.getByRole('textbox', { name: 'Headers: chave da linha 1' }).fill('X-Devagar');
  await hCada.getByRole('textbox', { name: 'Headers: valor da linha 1' }).fill('sim');
  await cada.getByRole('button', { name: /Rodar célula/ }).click();
  await pagina.waitForTimeout(1500);
  const noMeio = (await cada.locator('[data-saidas]').textContent().catch(() => '')) ?? '';
  marcar('para cada: o progresso aparece enquanto roda', /para cada muitos: \d+ de 39…/.test(noMeio), JSON.stringify(noMeio.slice(0, 80)));
  await pagina.locator('[data-notebook]').getByRole('button', { name: 'Parar' }).click();
  const saidaParada = await saidaDe(cada, 20000);
  marcar('Parar para entre um item e outro; os que rodaram valeram',
    /Parado depois de \d+ item/.test(saidaParada) && !/39 de 39/.test(saidaParada), JSON.stringify(saidaParada.slice(-140)));

  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  marcar('o .brnb guarda o "para cada" da célula HTTP',
    JSON.parse(readFileSync(arquivo, 'utf8')).celulas[11]?.paraCada === 'muitos');

  // ---- 12. etapa 5: OAuth 2.0 ----
  await pagina.locator('[data-notebook] [data-adicionar="13"]').getByRole('button', { name: 'HTTP' }).click();
  const prot = pagina.locator('[data-celula]').nth(13);
  await prot.getByRole('textbox', { name: 'URL da requisição' }).fill(`${API}/protegida`);
  await prot.getByRole('tab', { name: /Authorization/ }).click();
  await prot.getByRole('combobox', { name: 'Tipo de autorização' }).selectOption('oauth2');
  await prot.getByRole('textbox', { name: 'URL do token' }).fill(`${API}/oauth/token`);
  await prot.getByRole('textbox', { name: 'Client ID' }).fill('app');
  await prot.getByLabel('Client Secret', { exact: true }).pressSequentially('segredo');
  await prot.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaCc = await saidaDe(prot);
  marcar('OAuth Client Credentials: o token vem sozinho na primeira requisição, e a API aceita',
    /ok com tk-oauth-client_credentials/.test(saidaCc), JSON.stringify(saidaCc.slice(0, 120)));
  await pagina.waitForTimeout(500);
  marcar('a aba mostra o token no cofre, com validade e refresh (sem mostrar o token)',
    /Token no cofre, válido até .* renova sozinho/.test(await prot.locator('[data-token-oauth]').textContent()));

  // Authorization Code + PKCE: o login abre numa janela nova e volta à porta local.
  await prot.getByRole('combobox', { name: 'Fluxo do OAuth 2.0' }).selectOption('authorization_code');
  await prot.getByRole('textbox', { name: 'URL de autorização' }).fill(`${API}/oauth/authorize`);
  await prot.getByRole('textbox', { name: 'URL de retorno' }).fill(`http://localhost:${PORTA_DE_RETORNO}/callback`);
  await prot.getByRole('button', { name: 'Limpar token' }).click();
  const [janela] = await Promise.all([
    pagina.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
    prot.getByRole('button', { name: 'Pegar token novo' }).click(),
  ]);
  const paginaDeVolta = janela === null ? '' : await janela.waitForLoadState().then(() => janela.textContent('body')).catch(() => '');
  marcar('Authorization Code: "Pegar token novo" abre o login; a volta chega ao motor', /Login concluído/.test(paginaDeVolta ?? ''),
    JSON.stringify((paginaDeVolta ?? '').slice(0, 80)));
  await janela?.close();
  const recadoOAuth = prot.locator('[data-recado-oauth]');
  await pagina.waitForFunction(() => /Login concluído/.test(document.querySelector('[data-recado-oauth]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => undefined);
  marcar('…e a célula diz "Login concluído: token no cofre"', /Login concluído: token no cofre/.test(await recadoOAuth.textContent()));
  await prot.getByRole('button', { name: /Rodar célula/ }).click();
  const saidaCodigo = await saidaDe(prot);
  marcar('com o token do login (PKCE conferido pelo provedor), a API aceita',
    /ok com tk-oauth-authorization_code/.test(saidaCodigo), JSON.stringify(saidaCodigo.slice(0, 120)));
  await pagina.keyboard.press('Control+s');
  await pagina.waitForTimeout(800);
  const celulaOAuth = JSON.parse(readFileSync(arquivo, 'utf8')).celulas[13];
  marcar('o .brnb do OAuth: referências do cofre, nenhum token nem secret',
    /^http-/.test(celulaOAuth?.http?.autorizacao?.tokens ?? '') && !/tk-oauth|segredo/.test(JSON.stringify(celulaOAuth.http)),
    JSON.stringify(celulaOAuth?.http?.autorizacao).slice(0, 160));

  marcar('nenhum erro de JavaScript na página', errosDaPagina.length === 0, errosDaPagina.slice(0, 2).join(' | '));
} catch (erro) {
  marcar('a verificação rodou até o fim', false, erro instanceof Error ? erro.message.split('\n')[0] : String(erro));
} finally {
  await navegador?.close();
  motor.kill();
  api.closeAllConnections();
  api.close();
  rmSync(casa, { recursive: true, force: true });
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
