// A célula HTTP pela rota, com kernel de verdade (spec 120, etapa 1).
//
// O caminho de ponta a ponta: a resposta vira variável pelo NOME da célula,
// uma célula HTTP seguinte usa `{{login.body.token}}`, e uma célula Python lê
// o que veio.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
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
import { requisicaoVazia } from '../../shared/notebook/http';

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-nb-http-'));
const caminho = path.join(pasta, 'api.brnb');
const gerente = new GerenteDeKernels(plataformaAtual());

let api: Server;
let apiBase = '';
let motor: Server;
let base = '';
let autorizacaoRecebida: string | undefined;
/** O cofre de mentira: o de verdade tem os testes dele (vault.test.ts). */
const cofre = new Map<string, string>();

before(async () => {
  // A API de mentira: /login devolve um token; /eu exige ele.
  api = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.url === '/login') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token: 'tk-123', usuario: { nome: 'Ana' } }));
      } else if (req.url === '/eu') {
        autorizacaoRecebida = req.headers.authorization;
        res.writeHead(req.headers.authorization === 'Bearer tk-123' ? 200 : 401, { 'content-type': 'text/plain' });
        res.end('ok');
      } else if (req.url?.startsWith('/pedido/')) {
        const id = req.url.split('/')[2];
        if (id === '404') {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('não existe');
        } else {
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id: Number(id), status: 'ok' }));
          }, req.headers['x-devagar'] === 'sim' ? 150 : 0);
        }
      } else if (req.url === '/entrar') {
        res.writeHead(200, { 'set-cookie': 'sessao=s9; Path=/', 'content-type': 'text/plain' });
        res.end('entrou');
      } else if (req.url === '/quem') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`cookie: ${req.headers.cookie ?? '(nenhum)'}`);
      } else if (req.url === '/lento-curto') {
        setTimeout(() => res.end('ok'), 300);
      } else if (req.url === '/lento') {
        setTimeout(() => res.end('tarde'), 5_000);
      } else {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/notebook', createNotebookRouter(
    gerente, { acquire: async () => { throw new Error('sem banco'); } } as unknown as SessionPool, () => 'sqlite',
    undefined,
    { guardar: (ref, valor) => { cofre.set(ref, valor); }, ler: (ref) => cofre.get(ref) ?? null }
  ));
  app.use(errorEnvelope);
  motor = app.listen(0);
  await new Promise((r) => motor.once('listening', r));
  base = `http://127.0.0.1:${(motor.address() as AddressInfo).port}/api/notebook`;
});

after(() => {
  gerente.encerrarTodos();
  api.closeAllConnections();
  api.close();
  motor.closeAllConnections();
  motor.close();
});

async function pedir(metodo: string, rota: string, corpo?: unknown) {
  const r = await fetch(`${base}${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return (await r.json()) as { success: boolean; data: any; error: string | null };
}

async function rodarPython(codigo: string) {
  const { data, error } = await pedir('POST', '/kernel/executar', { caminho, linguagem: 'python', codigo, conexao: null });
  if (data === null) throw new Error(error ?? 'executar falhou');
  let saidas: any[] = [];
  for (let i = 0; i < 200; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(caminho)}&linguagem=python&exec=${data.exec}&desde=${saidas.length}`)).data;
    saidas = [...saidas.slice(0, q.inicio), ...q.saidas];
    if (q.terminou) return saidas.map((s) => s.texto ?? s.mensagem ?? '').join('');
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('não terminou');
}

test('a resposta vira variável; a próxima HTTP usa {{login.body.token}}; o Python lê', async () => {
  const login = await pedir('POST', '/kernel/http', {
    caminho, celula: 'h1', nome: 'login', linguagens: ['python'], raiz: pasta,
    http: { ...requisicaoVazia(), metodo: 'POST', url: `${apiBase}/login` },
  });
  assert.equal(login.success, true, login.error ?? '');
  assert.equal(login.data.saida.status, 200);
  assert.equal(login.data.variavel.nome, 'login');
  assert.deepEqual(login.data.variavel.linguagens, ['Python']);

  const eu = await pedir('POST', '/kernel/http', {
    caminho, celula: 'h2', nome: 'eu', linguagens: ['python'], raiz: pasta,
    http: {
      ...requisicaoVazia(), url: `${apiBase}/eu`,
      headers: [{ ligado: true, chave: 'Authorization', valor: 'Bearer {{login.body.token}}', descricao: '' }],
    },
  });
  assert.equal(eu.success, true, eu.error ?? '');
  assert.equal(autorizacaoRecebida, 'Bearer tk-123');
  assert.equal(eu.data.saida.status, 200);

  const lido = await rodarPython('print(login["body"]["usuario"]["nome"], login["status"], eu["body"])');
  assert.equal(lido, 'Ana 200 ok\n');
});

test('{{ }} de variável que não existe: erro com o nome, e a requisição não sai', async () => {
  autorizacaoRecebida = 'nada';
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'h3', nome: 'x', linguagens: ['python'], raiz: pasta,
    http: { ...requisicaoVazia(), url: `${apiBase}/eu`, headers: [{ ligado: true, chave: 'Authorization', valor: '{{naoexiste}}', descricao: '' }] },
  });
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /naoexiste/);
  assert.equal(autorizacaoRecebida, 'nada');
});

test('a resposta inteira fica no motor para salvar em disco (binário em base64)', async () => {
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'h4', nome: 'imagem', linguagens: ['python'], raiz: pasta,
    http: { ...requisicaoVazia(), url: `${apiBase}/png` },
  });
  assert.equal(r.data.saida.codificacao, 'base64');
  const corpo = await pedir('GET', `/kernel/http/corpo?caminho=${encodeURIComponent(caminho)}&celula=h4`);
  assert.equal(corpo.data.base64, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));
  assert.equal(corpo.data.mime, 'image/png');
});

test('Parar cancela a requisição em andamento', async () => {
  const indo = pedir('POST', '/kernel/http', {
    caminho, celula: 'h5', nome: 'lento', linguagens: ['python'], raiz: pasta,
    http: { ...requisicaoVazia(), url: `${apiBase}/lento` },
  });
  await new Promise((r) => setTimeout(r, 200));
  await pedir('POST', '/kernel/http/parar', { caminho });
  const r = await indo;
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /cancelada/i);
});

test('duas células do mesmo notebook ao mesmo tempo: uma não cancela a outra', async () => {
  const nb = path.join(pasta, 'paralelo.brnb');
  const [a, b] = await Promise.all(['pa', 'pb'].map((celula) => pedir('POST', '/kernel/http', {
    caminho: nb, celula, nome: null, linguagens: [], raiz: pasta,
    http: { ...requisicaoVazia(), url: `${apiBase}/lento-curto` },
  })));
  assert.equal(a.success, true, a.error ?? '');
  assert.equal(b.success, true, b.error ?? '');
});

test('nome de variável inválido é recusado', async () => {
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'h6', nome: 'class', linguagens: ['python'], raiz: pasta, http: requisicaoVazia(),
  });
  assert.equal(r.success, false);
});

for (const linguagem of ['javascript', 'php'] as const) {
  test(`${linguagem}: a resposta chega como estrutura e {{login.body.token}} sai dela`, async () => {
    const nb = path.join(pasta, `api-${linguagem}.brnb`);
    const login = await pedir('POST', '/kernel/http', {
      caminho: nb, celula: 'h1', nome: 'login', linguagens: [linguagem], raiz: pasta,
      http: { ...requisicaoVazia(), metodo: 'POST', url: `${apiBase}/login` },
    });
    assert.equal(login.success, true, login.error ?? '');
    autorizacaoRecebida = undefined;
    const eu = await pedir('POST', '/kernel/http', {
      caminho: nb, celula: 'h2', nome: 'eu', linguagens: [linguagem], raiz: pasta,
      http: {
        ...requisicaoVazia(), url: `${apiBase}/eu`,
        headers: [{ ligado: true, chave: 'Authorization', valor: 'Bearer {{login.body.token}}', descricao: '' }],
      },
    });
    assert.equal(eu.success, true, eu.error ?? '');
    assert.equal(autorizacaoRecebida, 'Bearer tk-123');
  });
}

// ---- Authorization com o cofre (etapa 2) ----

test('Bearer do cofre: guardar pela rota, e a requisição sai com o token', async () => {
  const ref = 'http-0123456789ab';
  const guardado = await pedir('POST', '/segredo', { ref, valor: 'tk-123' });
  assert.equal(guardado.success, true, guardado.error ?? '');
  assert.equal(cofre.get(ref), 'tk-123');
  autorizacaoRecebida = undefined;
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'a1', nome: null, linguagens: [], raiz: pasta,
    http: { ...requisicaoVazia(), url: `${apiBase}/eu`, autorizacao: { tipo: 'bearer', token: { cofre: ref } } },
  });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(autorizacaoRecebida, 'Bearer tk-123');
});

test('segredo que não está neste cofre: erro que diz o que fazer, e nada sai', async () => {
  autorizacaoRecebida = 'nada';
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'a2', nome: null, linguagens: [], raiz: pasta,
    http: { ...requisicaoVazia(), url: `${apiBase}/eu`, autorizacao: { tipo: 'bearer', token: { cofre: 'http-naoexiste000' } } },
  });
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /não está neste computador/);
  assert.equal(autorizacaoRecebida, 'nada');
});

test('a tela pergunta se o segredo existe; o valor só vem com revelar=1', async () => {
  cofre.set('http-perguntado01', 'segredo');
  const so = await pedir('GET', '/segredo?ref=http-perguntado01');
  assert.deepEqual(so.data, { existe: true });
  const revelado = await pedir('GET', '/segredo?ref=http-perguntado01&revelar=1');
  assert.deepEqual(revelado.data, { existe: true, valor: 'segredo' });
  assert.deepEqual((await pedir('GET', '/segredo?ref=http-faltando0001')).data, { existe: false });
});

test('Basic com {{ }} no usuário: o kernel dá o usuário, o cofre dá a senha', async () => {
  cofre.set('http-senhabasic01', 'pw');
  const login = await pedir('POST', '/kernel/http', {
    caminho, celula: 'a3', nome: 'login', linguagens: ['python'], raiz: pasta,
    http: { ...requisicaoVazia(), metodo: 'POST', url: `${apiBase}/login` },
  });
  assert.equal(login.success, true, login.error ?? '');
  autorizacaoRecebida = undefined;
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'a4', nome: null, linguagens: ['python'], raiz: pasta,
    http: {
      ...requisicaoVazia(), url: `${apiBase}/eu`,
      autorizacao: { tipo: 'basic', usuario: '{{login.body.usuario.nome}}', senha: { cofre: 'http-senhabasic01' } },
    },
  });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(autorizacaoRecebida, `Basic ${Buffer.from('Ana:pw').toString('base64')}`);
});

test('API Key na QUERY: a chave sai na requisição, mas não volta na saída nem na variável', async () => {
  cofre.set('http-chavequery01', 'SEGREDO-QUERY');
  const r = await pedir('POST', '/kernel/http', {
    caminho, celula: 'a5', nome: 'comchave', linguagens: ['python'], raiz: pasta,
    http: {
      ...requisicaoVazia(), url: `${apiBase}/eu`,
      autorizacao: { tipo: 'apikey', chave: 'api_key', valor: { cofre: 'http-chavequery01' }, onde: 'query' },
    },
  });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(JSON.stringify(r.data).includes('SEGREDO-QUERY'), false, JSON.stringify(r.data.saida.url));
  assert.match(r.data.saida.url, /api_key=•+/);
  const lido = await rodarPython('print(comchave["url"])');
  assert.equal(lido.includes('SEGREDO-QUERY'), false, lido);
});

// ---- etapa 3: cookies entre células e copiar como cURL ----

test('cookie de uma célula vai na seguinte; outro notebook não vê; limpar esvazia', async () => {
  const nb = path.join(pasta, 'cookies.brnb');
  const rodar = (celula: string, rota: string, caminhoDoNb = nb) => pedir('POST', '/kernel/http', {
    caminho: caminhoDoNb, celula, nome: null, linguagens: [], raiz: pasta, http: { ...requisicaoVazia(), url: `${apiBase}${rota}` },
  });
  await rodar('c1', '/entrar');
  assert.equal((await rodar('c2', '/quem')).data.saida.corpo, 'cookie: sessao=s9');
  assert.equal((await rodar('c3', '/quem', path.join(pasta, 'outro.brnb'))).data.saida.corpo, 'cookie: (nenhum)');
  const lista = await pedir('GET', `/kernel/http/cookies?caminho=${encodeURIComponent(nb)}`);
  assert.deepEqual(lista.data.map((c: { nome: string; valor: string }) => [c.nome, c.valor]), [['sessao', 's9']]);
  await pedir('POST', '/kernel/http/cookies/limpar', { caminho: nb });
  assert.equal((await rodar('c4', '/quem')).data.saida.corpo, 'cookie: (nenhum)');
});

test('copiar como cURL: o segredo do cofre entra no comando; {{ }} ficam como estão', async () => {
  cofre.set('http-paracurl0001', 'tk-do-cofre');
  const r = await pedir('POST', '/kernel/http/curl', {
    estilo: 'bash',
    http: {
      ...requisicaoVazia(), url: 'http://h/{{id}}',
      autorizacao: { tipo: 'bearer', token: { cofre: 'http-paracurl0001' } },
    },
  });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(r.data, "curl 'http://h/{{id}}' \\\n  -H 'Authorization: Bearer tk-do-cofre' \\\n  -L");
});

// ---- etapa 4: "para cada item" ----

test('para cada item de uma lista do Python: uma requisição por item; tabela e lista de respostas', async () => {
  const nb = path.join(pasta, 'para-cada.brnb');
  await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
  const { data } = await pedir('POST', '/kernel/executar', { caminho: nb, linguagem: 'python', codigo: "pedidos = [{'id': 7}, {'id': 404}, {'id': 9}]", conexao: null });
  for (let i = 0; i < 100; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&linguagem=python&exec=${data.exec}&desde=0`)).data;
    if (q.terminou) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const r = await pedir('POST', '/kernel/http', {
    caminho: nb, celula: 'pc', nome: 'detalhes', linguagens: ['python'], raiz: pasta, paraCada: 'pedidos',
    http: { ...requisicaoVazia(), url: `${apiBase}/pedido/{{item.id}}` },
  });
  assert.equal(r.success, true, r.error ?? '');
  assert.deepEqual(r.data.paraCada, { total: 3, feitos: 3, comErroDeStatus: 1, falha: null, parado: false });
  assert.deepEqual(r.data.tabela.linhas.map((l: unknown[]) => [l[0], l[1]]), [[1, 200], [2, 404], [3, 200]]);
  const lido = await (async () => {
    const ex = await pedir('POST', '/kernel/executar', { caminho: nb, linguagem: 'python', codigo: "print([(d['item']['id'], d['status'], d['body']['status'] if d['status'] == 200 else d['body']) for d in detalhes])", conexao: null });
    for (let i = 0; i < 100; i++) {
      const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&linguagem=python&exec=${ex.data.exec}&desde=0`)).data;
      if (q.terminou) return q.saidas.map((x: { texto?: string }) => x.texto ?? '').join('');
      await new Promise((res) => setTimeout(res, 25));
    }
    return '';
  })();
  assert.equal(lido, "[(7, 200, 'ok'), (404, 404, 'não existe'), (9, 200, 'ok')]\n");
});

test('para cada: o progresso aparece enquanto roda, e o Parar para entre um item e outro', async () => {
  const nb = path.join(pasta, 'para-cada-parar.brnb');
  await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
  const ex = await pedir('POST', '/kernel/executar', { caminho: nb, linguagem: 'javascript', codigo: 'ids = Array.from({ length: 20 }, (_, i) => i + 1)', conexao: null });
  for (let i = 0; i < 100; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&linguagem=javascript&exec=${ex.data.exec}&desde=0`)).data;
    if (q.terminou) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const indo = pedir('POST', '/kernel/http', {
    caminho: nb, celula: 'pp', nome: null, linguagens: ['javascript'], raiz: pasta, paraCada: 'ids',
    http: { ...requisicaoVazia(), url: `${apiBase}/pedido/{{item}}`, headers: [{ ligado: true, chave: 'X-Devagar', valor: 'sim', descricao: '' }] },
  });
  await new Promise((r) => setTimeout(r, 400));
  const progresso = await pedir('GET', `/kernel/http/progresso?caminho=${encodeURIComponent(nb)}&celula=pp`);
  assert.equal(progresso.data.total, 20);
  assert.ok(progresso.data.feitos > 0 && progresso.data.feitos < 20, JSON.stringify(progresso.data));
  await pedir('POST', '/kernel/http/parar', { caminho: nb });
  const r = await indo;
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(r.data.paraCada.parado, true);
  assert.ok(r.data.paraCada.feitos < 20);
});

test('para cada: nome que não é lista dá recado', async () => {
  const nb = path.join(pasta, 'para-cada-ruim.brnb');
  await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
  const ex = await pedir('POST', '/kernel/executar', { caminho: nb, linguagem: 'javascript', codigo: 'umNumero = 3', conexao: null });
  for (let i = 0; i < 100; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&linguagem=javascript&exec=${ex.data.exec}&desde=0`)).data;
    if (q.terminou) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const r = await pedir('POST', '/kernel/http', {
    caminho: nb, celula: 'pr', nome: null, linguagens: ['javascript'], raiz: pasta, paraCada: 'umNumero',
    http: { ...requisicaoVazia(), url: `${apiBase}/pedido/{{item}}` },
  });
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /umNumero não é uma lista/);
});
