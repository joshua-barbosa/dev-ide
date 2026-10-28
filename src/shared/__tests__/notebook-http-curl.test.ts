// Importar e copiar cURL na célula HTTP (spec 120, etapa 3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerCurl, paraCurl } from '../notebook/curl';
import { lerRequisicao, opcoesPadrao, requisicaoVazia, type RequisicaoHttp } from '../notebook/http';

const so = (texto: string): RequisicaoHttp => lerCurl(texto).requisicao;
const headers = (r: RequisicaoHttp) => r.headers.map((h) => [h.chave, h.valor]);

test('GET simples: a URL e os params dela', () => {
  const r = so("curl 'https://api.exemplo.test/x?a=1&b=2'");
  assert.equal(r.metodo, 'GET');
  assert.equal(r.url, 'https://api.exemplo.test/x?a=1&b=2');
  assert.deepEqual(r.params.map((p) => [p.chave, p.valor]), [['a', '1'], ['b', '2']]);
});

test('-X, -H repetido, aspas duplas e continuação de linha com \\', () => {
  const r = so('curl -X PUT "http://h/x" \\\n  -H "Accept: application/json" \\\n  -H \'X-Um: dois: três\'');
  assert.equal(r.metodo, 'PUT');
  assert.deepEqual(headers(r), [['Accept', 'application/json'], ['X-Um', 'dois: três']]);
});

test('-d sem Content-Type: x-www-form-urlencoded em linhas, e o método vira POST', () => {
  const r = so("curl http://h/x -d 'nome=Ana+Maria&cidade=S%C3%A3o%20Paulo' -d extra=1");
  assert.equal(r.metodo, 'POST');
  assert.deepEqual(r.corpo.tipo === 'urlencoded' && r.corpo.campos.map((c) => [c.chave, c.valor]),
    [['nome', 'Ana Maria'], ['cidade', 'São Paulo'], ['extra', '1']]);
});

test('--data-raw com Content-Type JSON: raw JSON, aspas simples com escape do bash', () => {
  const r = so(`curl http://h/x -H 'Content-Type: application/json' --data-raw '{"nome":"O'\\''Brien"}'`);
  assert.deepEqual(r.corpo, { tipo: 'raw', formato: 'json', texto: '{"nome":"O\'Brien"}' });
});

test('--json: raw JSON, POST', () => {
  const r = so(`curl --json '{"a":1}' http://h/x`);
  assert.equal(r.metodo, 'POST');
  assert.deepEqual(r.corpo, { tipo: 'raw', formato: 'json', texto: '{"a":1}' });
});

test('-F: form-data com texto e arquivo (@caminho)', () => {
  const r = so("curl http://h/x -F 'campo=valor' -F 'anexo=@/tmp/foto.png;type=image/png'");
  assert.deepEqual(r.corpo.tipo === 'form-data' && r.corpo.campos.map((c) => [c.chave, c.valor, c.tipo]),
    [['campo', 'valor', 'texto'], ['anexo', '/tmp/foto.png', 'arquivo']]);
});

test('--data-binary @arquivo: binary', () => {
  assert.deepEqual(so('curl http://h/x --data-binary @/tmp/dados.bin').corpo, { tipo: 'binario', arquivo: '/tmp/dados.bin' });
});

test('Authorization: Bearer no header vai para a aba Authorization (e daí para o cofre)', () => {
  const r = so("curl http://h/x -H 'Authorization: Bearer tk-1'");
  assert.deepEqual(r.autorizacao, { tipo: 'bearer', token: { texto: 'tk-1' } });
  assert.deepEqual(r.headers, []);
});

test('-u e Authorization: Basic viram Basic Auth', () => {
  assert.deepEqual(so('curl -u ana:s3nha http://h/x').autorizacao, { tipo: 'basic', usuario: 'ana', senha: { texto: 's3nha' } });
  const b64 = Buffer.from('bia:pw:com:dois-pontos').toString('base64');
  assert.deepEqual(so(`curl http://h/x -H 'Authorization: Basic ${b64}'`).autorizacao,
    { tipo: 'basic', usuario: 'bia', senha: { texto: 'pw:com:dois-pontos' } });
});

test('-k, -L, -m, -x viram as opções; flags juntas (-sSLk) também', () => {
  const r = so('curl -sSLk -m 7 -x http://proxy.exemplo.test:3128 http://h/x');
  assert.deepEqual(r.opcoes, { timeoutMs: 7000, seguirRedirecionamentos: true, ignorarCertificado: true, proxy: 'http://proxy.exemplo.test:3128' });
});

test('sem -L o cURL não segue redirecionamento — o importado também não', () => {
  assert.equal(so('curl http://h/x').opcoes.seguirRedirecionamentos, false);
});

test('-I é HEAD; -G manda o -d na query', () => {
  assert.equal(so('curl -I http://h/x').metodo, 'HEAD');
  const g = so('curl -G http://h/x -d a=1 -d b=2');
  assert.equal(g.metodo, 'GET');
  assert.equal(g.url, 'http://h/x?a=1&b=2');
  assert.deepEqual(g.corpo, { tipo: 'nenhum' });
});

test('-b, -A e -e viram headers Cookie, User-Agent e Referer', () => {
  assert.deepEqual(headers(so("curl http://h -b 's=1' -A 'meu-agente' -e http://origem")),
    [['Cookie', 's=1'], ['User-Agent', 'meu-agente'], ['Referer', 'http://origem']]);
});

test('o "Copy as cURL (cmd)" do Chrome no Windows: ^" e ^ no fim da linha', () => {
  const cmd = 'curl ^"https://api.exemplo.test/x?a=1^&b=2^" ^\r\n  -H ^"accept: application/json^" ^\r\n  --data-raw ^"^{^\\^"k^\\^":1^}^"';
  const r = so(cmd);
  assert.equal(r.url, 'https://api.exemplo.test/x?a=1&b=2');
  assert.deepEqual(headers(r), [['accept', 'application/json']]);
  assert.equal(r.corpo.tipo === 'raw' && r.corpo.texto, '{"k":1}');
});

test('flag desconhecida vira AVISO, não erro; o resto importa', () => {
  const { requisicao, avisos } = lerCurl('curl --tlsv1.3 --retry 3 http://h/x');
  assert.equal(requisicao.url, 'http://h/x');
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /--tlsv1\.3/);
});

test('texto que não é cURL: erro claro', () => {
  assert.throws(() => lerCurl('wget http://h'), /curl/);
  assert.throws(() => lerCurl('curl -H "a: b"'), /URL/);
});

// ---- copiar como cURL ----

const req = (r: Partial<RequisicaoHttp>): RequisicaoHttp => ({ ...requisicaoVazia(), url: 'http://h/x', ...r });

test('copiar (bash): método, headers, corpo JSON com aspas simples escapadas', () => {
  const c = paraCurl(req({
    metodo: 'POST', headers: [{ ligado: true, chave: 'X-A', valor: "it's", descricao: '' }],
    corpo: { tipo: 'raw', formato: 'json', texto: '{"a":"O\'B"}' },
  }), 'bash');
  assert.equal(c, "curl -X POST 'http://h/x' \\\n  -H 'X-A: it'\\''s' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"a\":\"O'\\''B\"}' \\\n  -L");
});

test('copiar: linha desligada não vai; opções viram -L, -k, --max-time, -x', () => {
  const c = paraCurl(req({
    headers: [{ ligado: false, chave: 'X-Off', valor: '1', descricao: '' }],
    opcoes: { timeoutMs: 2500, seguirRedirecionamentos: true, ignorarCertificado: true, proxy: 'http://p:1' },
  }), 'bash');
  assert.equal(c.includes('X-Off'), false);
  assert.match(c, / -L/);
  assert.match(c, / -k/);
  assert.match(c, /--max-time 2\.5/);
  assert.match(c, /-x 'http:\/\/p:1'/);
});

test('copiar: form-data com arquivo e urlencoded', () => {
  const f = paraCurl(req({ metodo: 'POST', corpo: { tipo: 'form-data', campos: [
    { ligado: true, chave: 'a', valor: 'b', descricao: '', tipo: 'texto' },
    { ligado: true, chave: 'f', valor: '/tmp/x.png', descricao: '', tipo: 'arquivo' },
  ] } }), 'bash');
  assert.match(f, /-F 'a=b'/);
  assert.match(f, /-F 'f=@\/tmp\/x\.png'/);
  const u = paraCurl(req({ metodo: 'POST', corpo: { tipo: 'urlencoded', campos: [{ ligado: true, chave: 'n', valor: 'a b', descricao: '' }] } }), 'bash');
  assert.match(u, /--data-urlencode 'n=a b'/);
});

test('copiar (cmd, Windows): o formato do "Copy as cURL (cmd)" do Chrome — ^"…^" e ^ antes do especial', () => {
  const c = paraCurl(req({ url: 'http://h/x?a=10%25&b=1', headers: [{ ligado: true, chave: 'X', valor: 'diz "oi"', descricao: '' }] }), 'cmd');
  // -L: a célula segue redirecionamento por padrão; o cURL não.
  assert.equal(c, 'curl ^"http://h/x?a=10^%25^&b=1^" ^\n  -H ^"X: diz \\^"oi\\^"^" ^\n  -L');
});

test('copiar (cmd): um valor com aspas e & NÃO vira comando (achado da revisão de 28/10)', () => {
  const malicioso = 'x" & calc & "y';
  const c = paraCurl(req({ headers: [{ ligado: true, chave: 'X', valor: malicioso, descricao: '' }] }), 'cmd');
  // Todo & e todo " do valor vão escapados com ^: o cmd não os interpreta.
  assert.equal(/(?<!\^)[&|<>]/.test(c), false, c);
  // E a volta (o mesmo comando importado) dá o valor exato.
  assert.equal(lerCurl(c).requisicao.headers.find((h) => h.chave === 'X')?.valor, malicioso);
});

test('copiar (cmd): quebra de linha num valor é recusada com recado (o cmd quebraria o comando)', () => {
  assert.throws(
    () => paraCurl(req({ metodo: 'POST', corpo: { tipo: 'raw', formato: 'texto', texto: 'a\nb' } }), 'cmd'),
    /quebra de linha.*bash/
  );
});

test('copiar (cmd): barra invertida antes de aspas e no fim sobrevive à ida e volta', () => {
  const valor = 'C:\\pasta\\" e fim\\';
  const c = paraCurl(req({ headers: [{ ligado: true, chave: 'X', valor, descricao: '' }] }), 'cmd');
  assert.equal(lerCurl(c).requisicao.headers.find((h) => h.chave === 'X')?.valor, valor);
});

test('ida e volta: o que se copia em bash se importa igual', () => {
  const original = req({
    metodo: 'PATCH', headers: [{ ligado: true, chave: 'X-A', valor: "it's", descricao: '' }],
    corpo: { tipo: 'raw', formato: 'json', texto: '{"a":1}' },
    opcoes: { ...opcoesPadrao(), seguirRedirecionamentos: true },
  });
  const volta = so(paraCurl(original, 'bash'));
  assert.equal(volta.metodo, 'PATCH');
  assert.deepEqual(volta.corpo, original.corpo);
  assert.equal(volta.headers.find((h) => h.chave === 'X-A')?.valor, "it's");
});

// ---- as opções no arquivo ----

test('opções: padrão e leitura tolerante', () => {
  assert.deepEqual(opcoesPadrao(), { timeoutMs: 0, seguirRedirecionamentos: true, ignorarCertificado: false, proxy: '' });
  assert.deepEqual(requisicaoVazia().opcoes, opcoesPadrao());
  assert.deepEqual(lerRequisicao({}).opcoes, opcoesPadrao());
  assert.deepEqual(lerRequisicao({ opcoes: { timeoutMs: -5, seguirRedirecionamentos: false, ignorarCertificado: 'sim', proxy: 3 } }).opcoes,
    { timeoutMs: 0, seguirRedirecionamentos: false, ignorarCertificado: false, proxy: '' });
});
