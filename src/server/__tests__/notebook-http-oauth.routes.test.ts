// OAuth 2.0 na célula HTTP, de ponta a ponta (spec 120, etapa 5): um
// provedor de mentira nesta máquina que confere tudo — Basic do client,
// senha, PKCE (sha256 do verifier contra o challenge), state e refresh — e uma
// API que só aceita token válido.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createNotebookRouter } from '../routes/notebook';
import { GerenteDeKernels } from '../notebook/gerente';
import { errorEnvelope } from '../http/handlers';
import type { SessionPool } from '../connections/pool';
import { plataformaAtual } from '../../shared/plataforma';
import { oauthVazio, requisicaoVazia, type AutorizacaoOAuth, type RequisicaoHttp } from '../../shared/notebook/http';

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-oauth-'));
const caminho = path.join(pasta, 'oauth.brnb');
const gerente = new GerenteDeKernels(plataformaAtual());
const cofre = new Map<string, string>();

let provedor: Server;
let P = '';
let motor: Server;
let base = '';
let portaDeRetorno = 0;

/** O estado do provedor de mentira. */
const tokensValidos = new Set<string>();
const pedidosDeToken: Record<string, string>[] = [];
let contador = 0;
let expiraEm = 3600;
const desafios = new Map<string, string>();

before(async () => {
  provedor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const pedacos: Buffer[] = [];
    req.on('data', (p: Buffer) => pedacos.push(p));
    req.on('end', () => {
      if (url.pathname === '/authorize') {
        // O "login": guarda o challenge e volta para o redirect_uri com o código.
        const codigo = `codigo-${++contador}`;
        desafios.set(codigo, url.searchParams.get('code_challenge') ?? '');
        const volta = new URL(url.searchParams.get('redirect_uri') ?? '');
        volta.searchParams.set('code', codigo);
        volta.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { location: volta.toString() });
        res.end();
        return;
      }
      if (url.pathname === '/token-eco') {
        // Um provedor mal-educado que devolve o formulário no erro.
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`erro com ${Buffer.concat(pedacos).toString()}`);
        return;
      }
      if (url.pathname === '/token-redireciona') {
        res.writeHead(307, { location: `${P}/token` });
        res.end();
        return;
      }
      if (url.pathname === '/token') {
        const f = Object.fromEntries(new URLSearchParams(Buffer.concat(pedacos).toString()));
        pedidosDeToken.push(f);
        const basic = req.headers.authorization === `Basic ${Buffer.from('app:segredo').toString('base64')}`;
        const noCorpo = f.client_id === 'app' && f.client_secret === 'segredo';
        const recusar = (erro: string, descricao: string) => {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: erro, error_description: descricao }));
        };
        if (!basic && !noCorpo) return recusar('invalid_client', 'client errado');
        if (f.grant_type === 'password' && !(f.username === 'ana' && f.password === 'pw')) return recusar('invalid_grant', 'senha errada');
        if (f.grant_type === 'authorization_code') {
          const desafio = desafios.get(f.code ?? '');
          const calculado = createHash('sha256').update(f.code_verifier ?? '').digest('base64url');
          if (desafio === undefined || desafio !== calculado) return recusar('invalid_grant', 'PKCE não confere');
        }
        if (f.grant_type === 'refresh_token' && !f.refresh_token?.startsWith('r-')) return recusar('invalid_grant', 'refresh ruim');
        const acesso = `a-${++contador}`;
        tokensValidos.add(acesso);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: acesso, token_type: 'Bearer', expires_in: expiraEm, refresh_token: `r-${contador}` }));
        return;
      }
      // A API: só com token válido.
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      res.writeHead(tokensValidos.has(token) ? 200 : 401, { 'content-type': 'text/plain' });
      res.end(tokensValidos.has(token) ? `ok com ${token}` : 'token inválido');
    });
  });
  await new Promise<void>((r) => provedor.listen(0, '127.0.0.1', r));
  P = `http://127.0.0.1:${(provedor.address() as AddressInfo).port}`;

  // Uma porta livre para o retorno do login.
  const livre = createServer();
  await new Promise<void>((r) => livre.listen(0, '127.0.0.1', r));
  portaDeRetorno = (livre.address() as AddressInfo).port;
  await new Promise((r) => livre.close(r));

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/notebook', createNotebookRouter(
    gerente, { acquire: async () => { throw new Error('sem banco'); } } as unknown as SessionPool, () => 'sqlite', undefined,
    { guardar: (ref, valor) => { cofre.set(ref, valor); }, ler: (ref) => cofre.get(ref) ?? null, apagar: (ref) => { cofre.delete(ref); } }
  ));
  app.use(errorEnvelope);
  motor = app.listen(0);
  await new Promise((r) => motor.once('listening', r));
  base = `http://127.0.0.1:${(motor.address() as AddressInfo).port}/api/notebook`;
});

after(() => {
  gerente.encerrarTodos();
  for (const s of [provedor, motor]) {
    s.closeAllConnections();
    s.close();
  }
});

async function pedir(metodo: string, rota: string, corpo?: unknown) {
  const r = await fetch(`${base}${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return (await r.json()) as { success: boolean; data: any; error: string | null };
}

const oauth = (ref: string, extra: Partial<AutorizacaoOAuth> = {}): AutorizacaoOAuth => ({
  ...oauthVazio(ref), urlDoToken: `${P}/token`, clientId: 'app', clientSecret: { texto: 'segredo' }, ...extra,
});
const req = (autorizacao: AutorizacaoOAuth): RequisicaoHttp => ({ ...requisicaoVazia(), url: `${P}/api`, autorizacao });
const rodar = (celula: string, autorizacao: AutorizacaoOAuth) =>
  pedir('POST', '/kernel/http', { caminho, celula, nome: null, linguagens: [], raiz: pasta, http: req(autorizacao) });

test('Client Credentials: o token vem sozinho na primeira requisição, fica no cofre e é reusado', async () => {
  const ref = 'http-oauthcc000001';
  const antes = pedidosDeToken.length;
  const r1 = await rodar('o1', oauth(ref));
  assert.equal(r1.success, true, r1.error ?? '');
  assert.match(r1.data.saida.corpo, /^ok com a-\d+$/);
  const r2 = await rodar('o1', oauth(ref));
  assert.equal(r2.data.saida.corpo, r1.data.saida.corpo);
  assert.equal(pedidosDeToken.length - antes, 1, 'pediu token de novo sem precisar');
  assert.equal(JSON.parse(cofre.get(ref) ?? '{}').acesso, r1.data.saida.corpo.replace('ok com ', ''));
});

test('credenciais no corpo, e o client secret vindo do cofre', async () => {
  cofre.set('http-secretdoapp01', 'segredo');
  const r = await rodar('o2', oauth('http-oauthcorpo001', { credenciaisNo: 'corpo', clientSecret: { cofre: 'http-secretdoapp01' } }));
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(pedidosDeToken.at(-1)?.client_secret, 'segredo');
});

test('Password: usuário e senha; senha errada dá o recado do provedor', async () => {
  const ok = await rodar('o3', oauth('http-oauthsenha001', { fluxo: 'password', usuario: 'ana', senha: { texto: 'pw' } }));
  assert.equal(ok.success, true, ok.error ?? '');
  const ruim = await rodar('o4', oauth('http-oauthsenha002', { fluxo: 'password', usuario: 'ana', senha: { texto: 'x' } }));
  assert.equal(ruim.success, false);
  assert.match(ruim.error ?? '', /invalid_grant: senha errada/);
});

test('token vencido: renova pelo REFRESH (não pede senha de novo)', async () => {
  const ref = 'http-oauthvence001';
  expiraEm = 1; // vence já (a folga é de 30 s)
  await rodar('o5', oauth(ref));
  expiraEm = 3600;
  await rodar('o5', oauth(ref));
  assert.equal(pedidosDeToken.at(-1)?.grant_type, 'refresh_token');
});

test('a API recusa o token guardado (401): pega outro e tenta UMA vez de novo', async () => {
  const ref = 'http-oauth401aaa01';
  const r1 = await rodar('o6', oauth(ref));
  tokensValidos.delete(r1.data.saida.corpo.replace('ok com ', ''));
  const r2 = await rodar('o6', oauth(ref));
  assert.equal(r2.data.saida.status, 200);
  assert.notEqual(r2.data.saida.corpo, r1.data.saida.corpo);
});

test('Authorization Code + PKCE: "Pegar token" abre o login, o retorno chega à porta local, o token vai ao cofre', async () => {
  const ref = 'http-oauthcodigo01';
  const a = oauth(ref, {
    fluxo: 'authorization_code', urlDeAutorizacao: `${P}/authorize`, urlDeRetorno: `http://127.0.0.1:${portaDeRetorno}/callback`,
  });
  // Sem token ainda: a requisição diz o que fazer.
  const semToken = await rodar('o7', a);
  assert.equal(semToken.success, false);
  assert.match(semToken.error ?? '', /Pegar token novo/);

  const inicio = await pedir('POST', '/oauth/token', { http: req(a) });
  assert.equal(inicio.success, true, inicio.error ?? '');
  const login = new URL(inicio.data.login.url);
  assert.equal(login.searchParams.get('code_challenge_method'), 'S256');
  // O "navegador": abre o login e segue o redirecionamento até a porta local.
  const pagina = await fetch(login, { redirect: 'follow' });
  assert.match(await pagina.text(), /Pode fechar esta aba/);
  let estado = '';
  for (let i = 0; i < 50 && estado !== 'pronto'; i++) {
    estado = (await pedir('GET', `/oauth/login?id=${inicio.data.login.id}`)).data.estado;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(estado, 'pronto');
  assert.equal(pedidosDeToken.at(-1)?.grant_type, 'authorization_code');

  const comToken = await rodar('o7', a);
  assert.equal(comToken.success, true, comToken.error ?? '');
  assert.equal(comToken.data.saida.status, 200);
  const situacao = await pedir('GET', `/oauth/estado?ref=${ref}`);
  assert.equal(situacao.data.tem, true);
  assert.equal(situacao.data.temRefresh, true);
  assert.equal(JSON.stringify(situacao.data).includes('a-'), false, 'o estado não mostra o token');
});

test('retorno com state errado é recusado (outra página tentando injetar um código)', async () => {
  const a = oauth('http-oauthstate001', {
    fluxo: 'authorization_code', urlDeAutorizacao: `${P}/authorize`, urlDeRetorno: `http://127.0.0.1:${portaDeRetorno}/callback`,
  });
  const inicio = await pedir('POST', '/oauth/token', { http: req(a) });
  const falso = await fetch(`http://127.0.0.1:${portaDeRetorno}/callback?code=x&state=errado`);
  assert.equal(falso.status, 400);
  const estado = (await pedir('GET', `/oauth/login?id=${inicio.data.login.id}`)).data;
  assert.equal(estado.estado, 'esperando');
  await fetch(new URL(inicio.data.login.url), { redirect: 'follow' });
});

test('URL de retorno que não é desta máquina é recusada', async () => {
  const a = oauth('http-oauthfora0001', { fluxo: 'authorization_code', urlDeAutorizacao: `${P}/authorize`, urlDeRetorno: 'https://exemplo.test/cb' });
  const r = await pedir('POST', '/oauth/token', { http: req(a) });
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /localhost/);
});

test('"Pegar token novo" no Client Credentials: pede na hora; "Limpar" esquece', async () => {
  const ref = 'http-oauthlimpa001';
  const r = await pedir('POST', '/oauth/token', { http: req(oauth(ref)) });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(r.data.estado.tem, true);
  await pedir('POST', '/oauth/limpar', { ref });
  assert.equal((await pedir('GET', `/oauth/estado?ref=${ref}`)).data.tem, false);
});

test('copiar como cURL com OAuth: o token guardado entra como Bearer; sem token, nada inventado', async () => {
  const ref = 'http-oauthcurl0001';
  await rodar('o9', oauth(ref));
  const acesso = JSON.parse(cofre.get(ref) ?? '{}').acesso as string;
  const com = await pedir('POST', '/kernel/http/curl', { estilo: 'bash', http: req(oauth(ref)) });
  assert.match(com.data, new RegExp(`-H 'Authorization: Bearer ${acesso}'`));
  const sem = await pedir('POST', '/kernel/http/curl', { estilo: 'bash', http: req(oauth('http-oauthsemtk001')) });
  assert.equal(sem.data.includes('Authorization'), false);
});

test('erro do provedor que ecoa o formulário: o secret e a senha saem mascarados no recado', async () => {
  const r = await rodar('o10', oauth('http-oauthecoa0001', {
    fluxo: 'password', urlDoToken: `${P}/token-eco`, usuario: 'ana', senha: { texto: 'senha-secreta' },
    credenciaisNo: 'corpo', clientSecret: { texto: 'segredo-do-app' },
  }));
  assert.equal(r.success, false);
  assert.equal(/senha-secreta|segredo-do-app/.test(r.error ?? ''), false, r.error ?? '');
  assert.match(r.error ?? '', /••••••/);
});

test('o pedido do token NÃO segue redirecionamento (o secret iria para outro endereço)', async () => {
  const antes = pedidosDeToken.length;
  const r = await rodar('o11', oauth('http-oauthredir001', { urlDoToken: `${P}/token-redireciona` }));
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /307/);
  assert.equal(pedidosDeToken.length, antes);
});
