// A célula HTTP sai do MOTOR (spec 120, etapa 1). Aqui, contra um servidor
// HTTP de mentira na própria máquina: o que importa é o que CHEGA nele.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { comoSaida, enviarRequisicao, type RespostaCompleta } from '../notebook/requisicao-http';
import { requisicaoVazia, valorDaVariavel, type RequisicaoHttp } from '../../shared/notebook/http';

interface Recebido {
  readonly metodo: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly corpo: Buffer;
}

/** 300 MB de zeros em ~300 KB: passa do teto de descompressão. */
const BOMBA = gzipSync(Buffer.alloc(300 * 1024 * 1024));
let servidor: Server;
let base = '';
let ultimo: Recebido | null = null;
const pasta = mkdtempSync(path.join(tmpdir(), 'braytech-http-'));

before(async () => {
  servidor = createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (p: Buffer) => pedacos.push(p));
    req.on('end', () => {
      ultimo = { metodo: req.method ?? '', url: req.url ?? '', headers: req.headers, corpo: Buffer.concat(pedacos) };
      const url = req.url ?? '';
      if (url.startsWith('/json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true,"lista":[1,2]}');
      } else if (url.startsWith('/gzip')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        res.end(gzipSync('comprimido'));
      } else if (url.startsWith('/png')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
      } else if (url.startsWith('/redireciona')) {
        res.writeHead(302, { location: '/json?veio=1' });
        res.end();
      } else if (url.startsWith('/lento')) {
        setTimeout(() => res.end('tarde'), 5_000);
      } else if (url.startsWith('/grande')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(2 * 1024 * 1024));
      } else if (url.startsWith('/para-outro')) {
        // Mesmo servidor, OUTRA origem (localhost × 127.0.0.1).
        res.writeHead(302, { location: base.replace('127.0.0.1', 'localhost') + '/x' });
        res.end();
      } else if (url.startsWith('/deflate-cru')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'deflate' });
        res.end(deflateRawSync('cru'));
      } else if (url.startsWith('/duas-vezes')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip, gzip' });
        res.end(gzipSync(gzipSync('dobrado')));
      } else if (url.startsWith('/bomba')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
        res.end(BOMBA);
      } else if (url.startsWith('/erro')) {
        res.writeHead(500, 'Deu Ruim', { 'content-type': 'text/plain' });
        res.end('falhou');
      } else {
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['a=1', 'b=2'] });
        res.end('eco');
      }
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const endereco = servidor.address();
  base = `http://127.0.0.1:${typeof endereco === 'object' && endereco !== null ? endereco.port : 0}`;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const req = (r: Partial<RequisicaoHttp>): RequisicaoHttp => ({ ...requisicaoVazia(), ...r });
const enviar = (r: Partial<RequisicaoHttp>): Promise<RespostaCompleta> => enviarRequisicao(req(r), {});
const recebido = (): Recebido => {
  assert.ok(ultimo !== null, 'o servidor não recebeu nada');
  return ultimo;
};

test('GET com a query da URL e o header pedido', async () => {
  const r = await enviar({ url: `${base}/x?a=1&b=dois`, headers: [{ ligado: true, chave: 'X-Teste', valor: 'sim', descricao: '' }] });
  assert.equal(r.status, 200);
  assert.equal(recebido().metodo, 'GET');
  assert.equal(recebido().url, '/x?a=1&b=dois');
  assert.equal(recebido().headers['x-teste'], 'sim');
});

test('sem esquema na URL: http://, como no Postman', async () => {
  const r = await enviar({ url: base.replace('http://', '') + '/x' });
  assert.equal(r.status, 200);
});

test('raw JSON: o corpo como está e Content-Type application/json', async () => {
  await enviar({ metodo: 'POST', url: `${base}/x`, corpo: { tipo: 'raw', formato: 'json', texto: '{"a": "olá"}' } });
  assert.equal(recebido().headers['content-type'], 'application/json');
  assert.equal(recebido().corpo.toString('utf8'), '{"a": "olá"}');
});

test('raw: o Content-Type que ele escreveu nos Headers manda', async () => {
  await enviar({
    metodo: 'POST', url: `${base}/x`, corpo: { tipo: 'raw', formato: 'xml', texto: '<a/>' },
    headers: [{ ligado: true, chave: 'content-type', valor: 'text/xml; charset=utf-8', descricao: '' }],
  });
  assert.equal(recebido().headers['content-type'], 'text/xml; charset=utf-8');
});

test('x-www-form-urlencoded: chave=valor codificado', async () => {
  await enviar({
    metodo: 'POST', url: `${base}/x`,
    corpo: { tipo: 'urlencoded', campos: [{ ligado: true, chave: 'nome', valor: 'Ana & Bia', descricao: '' }, { ligado: true, chave: 'n', valor: '1', descricao: '' }] },
  });
  assert.equal(recebido().headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(recebido().corpo.toString(), 'nome=Ana+%26+Bia&n=1');
});

test('form-data: texto e ARQUIVO (pelo caminho absoluto), em multipart', async () => {
  const arquivo = path.join(pasta, 'nota.txt');
  writeFileSync(arquivo, 'conteúdo do arquivo');
  await enviar({
    metodo: 'POST', url: `${base}/x`,
    corpo: {
      tipo: 'form-data',
      campos: [
        { ligado: true, chave: 'campo', valor: 'valor', descricao: '', tipo: 'texto' },
        { ligado: true, chave: 'anexo', valor: arquivo, descricao: '', tipo: 'arquivo' },
      ],
    },
  });
  const ct = String(recebido().headers['content-type']);
  assert.match(ct, /^multipart\/form-data; boundary=/);
  const corpo = recebido().corpo.toString('utf8');
  assert.match(corpo, /name="campo"\r\n\r\nvalor\r\n/);
  assert.match(corpo, /name="anexo"; filename="nota.txt"/);
  assert.match(corpo, /conteúdo do arquivo/);
});

test('form-data: arquivo que não existe é erro com o caminho, e nada sai', async () => {
  ultimo = null;
  await assert.rejects(
    enviar({
      metodo: 'POST', url: `${base}/x`,
      corpo: { tipo: 'form-data', campos: [{ ligado: true, chave: 'f', valor: '/nao/existe.bin', descricao: '', tipo: 'arquivo' }] },
    }),
    /\/nao\/existe\.bin/
  );
  assert.equal(ultimo, null);
});

test('binary: o arquivo byte a byte, application/octet-stream', async () => {
  const arquivo = path.join(pasta, 'dados.bin');
  const bytes = Buffer.from([0, 255, 1, 254, 10, 13]);
  writeFileSync(arquivo, bytes);
  await enviar({ metodo: 'PUT', url: `${base}/x`, corpo: { tipo: 'binario', arquivo } });
  assert.equal(recebido().headers['content-type'], 'application/octet-stream');
  assert.deepEqual(recebido().corpo, bytes);
});

test('resposta JSON: vira saída de texto e a variável traz o body lido', async () => {
  const r = await enviar({ url: `${base}/json` });
  const saida = comoSaida(r);
  assert.equal(saida.codificacao, 'texto');
  assert.equal(saida.corpo, '{"ok":true,"lista":[1,2]}');
  assert.deepEqual(valorDaVariavel(comoSaida(r, Infinity)).body, { ok: true, lista: [1, 2] });
});

test('resposta comprimida (gzip) chega descomprimida', async () => {
  const r = await enviar({ url: `${base}/gzip` });
  assert.equal(comoSaida(r).corpo, 'comprimido');
  assert.equal(r.tamanho, 'comprimido'.length);
});

test('resposta binária (PNG) vai em base64', async () => {
  const saida = comoSaida(await enviar({ url: `${base}/png` }));
  assert.equal(saida.codificacao, 'base64');
  assert.deepEqual(Buffer.from(saida.corpo, 'base64'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
});

test('redirecionamento é seguido; a URL final aparece', async () => {
  const r = await enviar({ url: `${base}/redireciona` });
  assert.equal(r.status, 200);
  assert.equal(r.url, `${base}/json?veio=1`);
});

test('status de erro NÃO é exceção: é resposta, com o texto do status', async () => {
  const r = await enviar({ url: `${base}/erro` });
  assert.equal(r.status, 500);
  assert.equal(r.statusTexto, 'Deu Ruim');
  assert.equal(comoSaida(r).corpo, 'falhou');
});

test('set-cookie repetido chega como dois pares', async () => {
  const r = await enviar({ url: `${base}/x` });
  assert.deepEqual(r.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v), ['a=1', 'b=2']);
});

test('corpo grande: a saída guardada tem teto e diz que cortou; o tamanho é o de verdade', async () => {
  const r = await enviar({ url: `${base}/grande` });
  const saida = comoSaida(r);
  assert.equal(saida.truncado, true);
  assert.equal(saida.corpo.length, 1024 * 1024);
  assert.equal(saida.tamanho, 2 * 1024 * 1024);
});

test('Parar: o sinal cancela a requisição em andamento', async () => {
  const controle = new AbortController();
  const promessa = enviarRequisicao(req({ url: `${base}/lento` }), { sinal: controle.signal });
  setTimeout(() => controle.abort(), 100);
  await assert.rejects(promessa, /cancelada/i);
});

test('servidor que não existe: erro claro com o endereço', async () => {
  await assert.rejects(enviar({ url: 'http://127.0.0.1:1/x' }), /127\.0\.0\.1:1/);
});

test('URL vazia: erro claro antes de sair', async () => {
  await assert.rejects(enviar({ url: '' }), /URL/);
});

test('redirecionamento para OUTRA origem não leva Authorization nem Cookie', async () => {
  await enviar({
    url: `${base}/para-outro`,
    headers: [
      { ligado: true, chave: 'Authorization', valor: 'Bearer segredo', descricao: '' },
      { ligado: true, chave: 'Cookie', valor: 's=1', descricao: '' },
      { ligado: true, chave: 'X-Outro', valor: 'fica', descricao: '' },
    ],
  });
  assert.equal(recebido().headers.host?.startsWith('localhost'), true);
  assert.equal(recebido().headers.authorization, undefined);
  assert.equal(recebido().headers.cookie, undefined);
  assert.equal(recebido().headers['x-outro'], 'fica');
});

test('redirecionamento na MESMA origem mantém o Authorization', async () => {
  await enviar({ url: `${base}/redireciona`, headers: [{ ligado: true, chave: 'Authorization', valor: 'Bearer x', descricao: '' }] });
  assert.equal(recebido().headers.authorization, 'Bearer x');
});

test('deflate "cru" (sem cabeçalho zlib) também abre', async () => {
  assert.equal(comoSaida(await enviar({ url: `${base}/deflate-cru` })).corpo, 'cru');
});

test('Content-Encoding empilhado ("gzip, gzip") abre camada por camada', async () => {
  assert.equal(comoSaida(await enviar({ url: `${base}/duas-vezes` })).corpo, 'dobrado');
});

test('bomba de descompressão: erro claro, e o motor continua de pé', async () => {
  await assert.rejects(enviar({ url: `${base}/bomba` }), /grande demais/);
  assert.equal((await enviar({ url: `${base}/x` })).status, 200);
});

test('Content-Length escrito por ele (outra caixa) não sai duplicado', async () => {
  await enviar({
    metodo: 'POST', url: `${base}/x`, corpo: { tipo: 'raw', formato: 'texto', texto: 'abc' },
    headers: [{ ligado: true, chave: 'content-length', valor: '999', descricao: '' }],
  });
  assert.equal(recebido().headers['content-length'], '3');
  assert.equal(recebido().corpo.toString(), 'abc');
});

test('sem Content-Type: binário sem NUL (latin1) não vira texto', () => {
  const bytes = Buffer.alloc(5000, 0xe9);
  const r = { status: 200, statusTexto: 'OK', headers: [], tipoDeConteudo: '', corpo: bytes, tamanho: bytes.length, tempoMs: 0, url: 'http://h' };
  assert.equal(comoSaida(r).codificacao, 'base64');
  const texto = Buffer.from('á'.repeat(3000));
  assert.equal(comoSaida({ ...r, corpo: texto, tamanho: texto.length }).codificacao, 'texto');
});

test('redirecionamento para OUTRA origem não leva os headers sensíveis pedidos (API Key)', async () => {
  await enviarRequisicao(req({
    url: `${base}/para-outro`,
    headers: [{ ligado: true, chave: 'X-Api-Key', valor: 'k', descricao: '' }],
  }), { headersSensiveis: ['x-api-key'] });
  assert.equal(recebido().headers['x-api-key'], undefined);
});
