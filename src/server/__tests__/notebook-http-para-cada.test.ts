// "Para cada item" na célula HTTP (spec 120, etapa 4): uma requisição por
// item da lista, com {{item}}; erro de REDE para ali; 4xx/5xx é resposta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rodarParaCadaHttp } from '../notebook/para-cada-http';
import { requisicaoVazia, type RequisicaoHttp } from '../../shared/notebook/http';
import type { RespostaCompleta } from '../notebook/requisicao-http';

const resposta = (status: number, corpo: string, tipo = 'application/json'): RespostaCompleta => ({
  status, statusTexto: status === 200 ? 'OK' : 'Not Found', headers: [['content-type', tipo]], tipoDeConteudo: tipo,
  corpo: Buffer.from(corpo), tamanho: Buffer.byteLength(corpo), tempoMs: 5, url: 'http://h/x',
});

const base: RequisicaoHttp = { ...requisicaoVazia(), url: 'http://h/pedidos/{{item.id}}?token={{token}}' };

test('uma requisição por item, com {{item.campo}} e os outros {{ }}; respostas na ordem', async () => {
  const urls: string[] = [];
  const progresso: string[] = [];
  const r = await rodarParaCadaHttp({
    itens: [{ id: 1 }, { id: 2 }], requisicao: base, outros: { token: 'tk' },
    enviar: async (req) => {
      urls.push(req.url);
      return resposta(200, JSON.stringify({ id: Number(req.url.split('/')[4].split('?')[0]) }));
    },
    parar: () => false,
    aoProgresso: (feitos, total) => progresso.push(`${feitos}/${total}`),
  });
  assert.deepEqual(urls, ['http://h/pedidos/1?token=tk', 'http://h/pedidos/2?token=tk']);
  assert.deepEqual(progresso, ['0/2', '1/2', '2/2']);
  assert.deepEqual(r.respostas.map((x) => [x.item, x.status, x.body]), [[{ id: 1 }, 200, { id: 1 }], [{ id: 2 }, 200, { id: 2 }]]);
  assert.deepEqual(r.colunas, ['item', 'status', 'tempo', 'tamanho', 'body']);
  assert.deepEqual(r.linhas[0], [1, 200, 5, 8, '{"id":1}']);
  assert.equal(r.falha, null);
});

test('404 NÃO para: é resposta; o resumo conta os com erro de status', async () => {
  const r = await rodarParaCadaHttp({
    itens: [1, 2, 3], requisicao: { ...base, url: 'http://h/{{item}}' }, outros: {},
    enviar: async (req) => (req.url.endsWith('/2') ? resposta(404, 'não achei', 'text/plain') : resposta(200, '{}')),
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.equal(r.respostas.length, 3);
  assert.equal(r.comErroDeStatus, 1);
  assert.deepEqual(r.linhas[1], [2, 404, 5, 10, 'não achei']);
});

test('erro de REDE para ali: os anteriores valeram, o recado diz qual item', async () => {
  const r = await rodarParaCadaHttp({
    itens: ['a', 'b', 'c'], requisicao: { ...base, url: 'http://h/{{item}}' }, outros: {},
    enviar: async (req) => {
      if (req.url.endsWith('/b')) throw new Error('h: ECONNREFUSED');
      return resposta(200, '{}');
    },
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.equal(r.respostas.length, 1);
  assert.deepEqual(r.falha, { item: 2, mensagem: 'h: ECONNREFUSED' });
});

test('{{item.campo}} que não existe num item: falha NAQUELE item, com o nome', async () => {
  const r = await rodarParaCadaHttp({
    itens: [{ id: 1 }, { outro: 2 }], requisicao: { ...base, url: 'http://h/{{item.id}}' }, outros: {},
    enviar: async () => resposta(200, '{}'), parar: () => false, aoProgresso: () => undefined,
  });
  assert.equal(r.respostas.length, 1);
  assert.equal(r.falha?.item, 2);
  assert.match(r.falha?.mensagem ?? '', /item\.id/);
});

test('Parar: entre um item e outro', async () => {
  let enviados = 0;
  const r = await rodarParaCadaHttp({
    itens: [1, 2, 3, 4], requisicao: { ...base, url: 'http://h/{{item}}' }, outros: {},
    enviar: async () => {
      enviados += 1;
      return resposta(200, '{}');
    },
    parar: () => enviados >= 2, aoProgresso: () => undefined,
  });
  assert.equal(r.parado, true);
  assert.equal(r.respostas.length, 2);
});

test('body grande na TABELA é cortado (a variável tem tudo)', async () => {
  const grande = 'x'.repeat(5000);
  const r = await rodarParaCadaHttp({
    itens: [1], requisicao: { ...base, url: 'http://h/{{item}}' }, outros: {},
    enviar: async () => resposta(200, grande, 'text/plain'), parar: () => false, aoProgresso: () => undefined,
  });
  assert.equal(String(r.linhas[0][4]).length < 1100, true);
  assert.equal(r.respostas[0].body, grande);
});
