// A aba Settings e os cookies da célula HTTP, no motor (spec 120, etapa 3):
// timeout, seguir ou não o redirecionamento, certificado inválido, proxy (o da
// célula e o do sistema, inclusive o túnel CONNECT do https) e o pote de
// cookies entre requisições.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createServer, request as requestHttp, type Server } from 'node:http';
import { createServer as createServerHttps, type Server as ServerHttps } from 'node:https';
import { connect, type AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enviarRequisicao } from '../notebook/requisicao-http';
import { PoteDeCookies } from '../notebook/cookies-http';
import { opcoesPadrao, requisicaoVazia, type OpcoesHttp, type RequisicaoHttp } from '../../shared/notebook/http';

let servidor: Server;
let base = '';
let seguro: ServerHttps | null = null;
let baseSegura = '';
let proxy: Server;
let baseDoProxy = '';
const passouPeloProxy: string[] = [];
let cookieRecebido: string | undefined;

/** Um certificado autoassinado feito na hora: nenhuma chave vai para o repositório. */
function certificado(): { key: Buffer; cert: Buffer } | null {
  const pasta = mkdtempSync(path.join(tmpdir(), 'braytech-cert-'));
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-keyout', path.join(pasta, 'k.pem'), '-out', path.join(pasta, 'c.pem'),
    ], { stdio: 'ignore' });
    return { key: readFileSync(path.join(pasta, 'k.pem')), cert: readFileSync(path.join(pasta, 'c.pem')) };
  } catch {
    return null;
  }
}

before(async () => {
  servidor = createServer((req, res) => {
    req.resume();
    cookieRecebido = req.headers.cookie;
    if (req.url === '/lento') {
      setTimeout(() => res.end('tarde'), 3000);
    } else if (req.url === '/login') {
      // Login que põe a sessão e REDIRECIONA: o cookie vale já no salto.
      res.writeHead(302, { 'set-cookie': 'sessao=s1; Path=/; HttpOnly', location: '/painel' });
      res.end();
    } else if (req.url === '/redireciona') {
      res.writeHead(302, { location: '/destino' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ok ${req.url}`);
    }
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const par = certificado();
  if (par !== null) {
    seguro = createServerHttps(par, (_req, res) => res.end('seguro'));
    await new Promise<void>((r) => seguro?.listen(0, '127.0.0.1', r));
    baseSegura = `https://127.0.0.1:${(seguro.address() as AddressInfo).port}`;
  }

  // Um proxy http de verdade: URL absoluta para http, CONNECT para https.
  proxy = createServer((req, res) => {
    passouPeloProxy.push(`${req.method} ${req.url}`);
    const alvo = new URL(req.url ?? '');
    const ida = requestHttp(alvo, { method: req.method, headers: req.headers }, (volta) => {
      res.writeHead(volta.statusCode ?? 502, volta.headers);
      volta.pipe(res);
    });
    req.pipe(ida);
  });
  proxy.on('connect', (req, socket) => {
    passouPeloProxy.push(`CONNECT ${req.url}`);
    const [host, porta] = (req.url ?? '').split(':');
    const tunel = connect(Number(porta), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      tunel.pipe(socket);
      socket.pipe(tunel);
    });
    tunel.on('error', () => socket.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  baseDoProxy = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

after(() => {
  for (const s of [servidor, proxy, seguro]) {
    s?.closeAllConnections();
    s?.close();
  }
});

const req = (url: string, opcoes: Partial<OpcoesHttp> = {}, r: Partial<RequisicaoHttp> = {}): RequisicaoHttp =>
  ({ ...requisicaoVazia(), url, ...r, opcoes: { ...opcoesPadrao(), ...opcoes } });

test('timeout: passa do tempo, erro que diz o tempo', async () => {
  const inicio = Date.now();
  await assert.rejects(enviarRequisicao(req(`${base}/lento`, { timeoutMs: 300 }), {}), /Tempo esgotado \(300 ms\)/);
  assert.ok(Date.now() - inicio < 2000);
});

test('timeout 0: sem limite (a requisição rápida volta normal)', async () => {
  assert.equal((await enviarRequisicao(req(`${base}/x`, { timeoutMs: 0 }), {})).status, 200);
});

test('seguir redirecionamento DESLIGADO: volta o 302, com o Location', async () => {
  const r = await enviarRequisicao(req(`${base}/redireciona`, { seguirRedirecionamentos: false }), {});
  assert.equal(r.status, 302);
  assert.deepEqual(r.headers.find(([k]) => k === 'location'), ['location', '/destino']);
});

test('certificado autoassinado: recusado por padrão, aceito com "ignorar certificado"', async (t) => {
  if (seguro === null) {
    t.skip('sem openssl nesta máquina');
    return;
  }
  await assert.rejects(enviarRequisicao(req(`${baseSegura}/`), {}), /certificado/i);
  const r = await enviarRequisicao(req(`${baseSegura}/`, { ignorarCertificado: true }), {});
  assert.equal(r.corpo.toString(), 'seguro');
});

test('proxy da célula, destino http: a requisição passa pelo proxy', async () => {
  passouPeloProxy.length = 0;
  const r = await enviarRequisicao(req(`${base}/via?a=1`, { proxy: baseDoProxy }), {});
  assert.equal(r.corpo.toString(), 'ok /via?a=1');
  assert.deepEqual(passouPeloProxy, [`GET ${base}/via?a=1`]);
});

test('proxy do SISTEMA (HTTP_PROXY), e NO_PROXY tira o host', async () => {
  passouPeloProxy.length = 0;
  await enviarRequisicao(req(`${base}/sis`), { ambiente: { HTTP_PROXY: baseDoProxy } });
  assert.equal(passouPeloProxy.length, 1);
  await enviarRequisicao(req(`${base}/sis`), { ambiente: { HTTP_PROXY: baseDoProxy, NO_PROXY: '127.0.0.1' } });
  assert.equal(passouPeloProxy.length, 1);
});

test('proxy com destino https: túnel CONNECT (e o certificado continua conferido)', async (t) => {
  if (seguro === null) {
    t.skip('sem openssl nesta máquina');
    return;
  }
  passouPeloProxy.length = 0;
  await assert.rejects(enviarRequisicao(req(`${baseSegura}/`, { proxy: baseDoProxy }), {}), /certificado/i);
  const r = await enviarRequisicao(req(`${baseSegura}/`, { proxy: baseDoProxy, ignorarCertificado: true }), {});
  assert.equal(r.corpo.toString(), 'seguro');
  assert.equal(passouPeloProxy.every((p) => p.startsWith('CONNECT 127.0.0.1:')), true, passouPeloProxy.join(' | '));
});

test('proxy que não responde: erro que diz que é o PROXY', async () => {
  await assert.rejects(enviarRequisicao(req(`${base}/x`, { proxy: 'http://127.0.0.1:1' }), {}), /proxy 127\.0\.0\.1:1/i);
});

test('cookies: o Set-Cookie do login vale já no redirecionamento, e na próxima requisição', async () => {
  const pote = new PoteDeCookies();
  cookieRecebido = undefined;
  const r = await enviarRequisicao(req(`${base}/login`), { cookies: pote });
  assert.equal(r.corpo.toString(), 'ok /painel');
  assert.equal(cookieRecebido, 'sessao=s1');
  cookieRecebido = undefined;
  await enviarRequisicao(req(`${base}/outra`), { cookies: pote });
  assert.equal(cookieRecebido, 'sessao=s1');
});

test('cookies: o header Cookie escrito à mão vale mais que o pote', async () => {
  const pote = new PoteDeCookies();
  pote.guardar(new URL(`${base}/`), ['sessao=do-pote']);
  await enviarRequisicao(req(`${base}/x`, {}, { headers: [{ ligado: true, chave: 'Cookie', valor: 'sessao=na-mao', descricao: '' }] }), { cookies: pote });
  assert.equal(cookieRecebido, 'sessao=na-mao');
});
