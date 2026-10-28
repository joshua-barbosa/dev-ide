// O que o arquivo guardou volta como variável num kernel NOVO (relato de 28/10).
//
// O relato: o kernel PHP parava sozinho, e a resposta HTTP salva no `.brnb` não
// servia mais para a célula de baixo — só rodando a célula HTTP de novo. Aqui,
// com PHP de verdade: a tela conta o que o arquivo guardou, e o kernel que
// nasce (o primeiro, o que voltou, o do Reiniciar) já tem as variáveis.
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
import type { Guardado } from '../../shared/notebook/guardados';

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-nb-guardados-'));
const caminho = path.join(pasta, 'exemplo.brnb');
const gerente = new GerenteDeKernels(plataformaAtual());

let api: Server;
let apiBase = '';
let motor: Server;
let base = '';

before(async () => {
  // A API de mentira: /pedido/N devolve o pedido N.
  api = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pedido: Number(req.url?.split('/')[2]) }));
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/notebook', createNotebookRouter(
    gerente, { acquire: async () => { throw new Error('sem banco'); } } as unknown as SessionPool, () => 'sqlite'
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

async function rodar(linguagem: 'php' | 'javascript', codigo: string): Promise<string> {
  const subiu = await pedir('POST', '/kernel', { caminho, linguagem });
  if (!subiu.success) throw new Error(subiu.error ?? 'o kernel não subiu');
  const { data, error } = await pedir('POST', '/kernel/executar', { caminho, linguagem, codigo, conexao: null });
  if (data === null) throw new Error(error ?? 'executar falhou');
  for (let i = 0; i < 200; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(caminho)}&linguagem=${linguagem}&exec=${data.exec}&desde=0`)).data;
    if (q.terminou) return q.saidas.map((s: any) => s.texto ?? s.mensagem ?? '').join('');
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('a célula não terminou');
}

const rodarPhp = (codigo: string) => rodar('php', codigo);

const GUARDADOS: Guardado[] = [
  {
    celula: 'h1', nome: 'pedido', tipo: 'valor',
    valor: { status: 200, statusTexto: 'OK', headers: {}, body: { id: 7, itens: [10, 20] }, tempo: 5, tamanho: 30, url: 'https://x.test' },
  },
  { celula: 's1', nome: 'clientes', tipo: 'tabela', colunas: ['id', 'nome'], linhas: [[1, 'Ana'], [2, 'Bia']] },
  { celula: 's2', nome: 'vendas', tipo: 'faltando', motivo: 'o arquivo guarda só 500 de 900 linhas' },
];

test('o kernel que nasce já tem a resposta HTTP e o resultado SQL guardados', async () => {
  await pedir('POST', '/kernel/guardados', { caminho, guardados: GUARDADOS });
  assert.equal(await rodarPhp('$pedido["body"]["id"] + count($pedido["body"]["itens"])'), '9\n');
  assert.equal(await rodarPhp('$clientes[1]["nome"]'), "'Bia'\n");
  const faltando = (await pedir('GET', `/kernel/nao-restaurados?caminho=${encodeURIComponent(caminho)}`)).data;
  assert.deepEqual(faltando, [{ celula: 's2', nome: 'vendas', motivo: 'o arquivo guarda só 500 de 900 linhas' }]);
});

test('o kernel morreu: o próximo volta com as variáveis do arquivo (e não com as da célula)', async () => {
  await rodarPhp('$pedido = "mexido";');
  await pedir('POST', '/kernel/encerrar', { caminho, linguagem: 'php' });
  assert.equal(await rodarPhp('$pedido["body"]["id"]'), '7\n');
});

test('Reiniciar também volta com o que o arquivo guardou', async () => {
  const r = await pedir('POST', '/kernel/reiniciar', { caminho, linguagem: 'php' });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(await rodarPhp('$clientes[0]["id"]'), '1\n');
});

test('célula HTTP com {{pedido.body.id}} e nenhum kernel de pé: o kernel sobe e nasce com o valor', async () => {
  gerente.encerrar(caminho);
  const http = { ...requisicaoVazia(), url: `${apiBase}/pedido/{{pedido.body.id}}` };
  const r = await pedir('POST', '/kernel/http', { caminho, celula: 'h2', nome: 'detalhe', linguagens: ['php'], raiz: null, http });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(r.data.saida.corpo, '{"pedido":7}');
  assert.equal(await rodarPhp('$detalhe["body"]["pedido"]'), '7\n');
});

test('a célula que entregou o nome de novo apaga o aviso de que ele não voltou', async () => {
  const http = { ...requisicaoVazia(), url: `${apiBase}/pedido/3` };
  await pedir('POST', '/kernel/http', { caminho, celula: 's2', nome: 'vendas', linguagens: ['php'], raiz: null, http });
  assert.deepEqual((await pedir('GET', `/kernel/nao-restaurados?caminho=${encodeURIComponent(caminho)}`)).data, []);
});

test('outra linguagem mudou o valor depois: o kernel que nasce recebe o MAIS NOVO, não o do arquivo', async () => {
  assert.equal(await rodar('javascript', 'pedido.body.id = 99;\npedido.body.id'), '99\n');
  // Uma célula PHP no meio: a cascata já entregou o 99 — e o Reiniciar não pode voltar ao 7.
  assert.equal(await rodarPhp('$pedido["body"]["id"]'), '99\n');
  const r = await pedir('POST', '/kernel/reiniciar', { caminho, linguagem: 'php' });
  assert.equal(r.success, true, r.error ?? '');
  assert.equal(await rodarPhp('$pedido["body"]["id"]'), '99\n');
});

test('fechar o notebook esquece o que ele guardou', async () => {
  await pedir('POST', '/kernel/encerrar', { caminho });
  assert.equal(gerente.temGuardado(caminho, ['pedido']), false);
  assert.match(await rodarPhp('isset($pedido) ? "tem" : "não tem"'), /não tem/);
});
