// O que o arquivo guardou e volta como variável num kernel novo (relato de 28/10).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardadosDoNotebook, lerGuardados } from '../notebook/guardados';
import {
  alterarCelula, inserirCelula, notebookNovo, registrarExecucao, saidaDeTabela, SAIDA_MAX_LINHAS,
  type Notebook, type Saida,
} from '../notebook/modelo';
import type { SaidaHttp } from '../notebook/http';

function vazio(): Notebook {
  return { ...notebookNovo('php', null), celulas: [] };
}

function celula(nb: Notebook, id: string, tipo: 'sql' | 'http' | 'codigo', nome: string | null, saidas: readonly Saida[]): Notebook {
  const com = inserirCelula(nb, tipo, nb.celulas.length, id);
  const nomeado = nome === null ? com : alterarCelula(com, id, { nome });
  return saidas.length === 0 ? nomeado : registrarExecucao(nomeado, id, 1, saidas);
}

function resposta(mais: Partial<SaidaHttp> = {}): SaidaHttp {
  return {
    tipo: 'http', status: 200, statusTexto: 'OK', tempoMs: 12, tamanho: 13, url: 'https://api.exemplo.test/pedidos/7',
    headers: [['Content-Type', 'application/json'], ['X-Pagina', '1']], tipoDeConteudo: 'application/json',
    corpo: '{"id":7,"ok":true}', codificacao: 'texto', truncado: false, ...mais,
  };
}

test('HTTP: a resposta guardada volta como a MESMA variável que a célula entregou', () => {
  const nb = celula(vazio(), 'h1', 'http', 'pedido', [resposta(), { tipo: 'texto', fluxo: 'saida', texto: '→ pedido: …\n' }]);
  assert.deepEqual(guardadosDoNotebook(nb), [{
    celula: 'h1', nome: 'pedido', tipo: 'valor',
    valor: {
      status: 200, statusTexto: 'OK', headers: { 'content-type': 'application/json', 'x-pagina': '1' },
      body: { id: 7, ok: true }, tempo: 12, tamanho: 13, url: 'https://api.exemplo.test/pedidos/7',
    },
  }]);
});

test('HTTP: resposta cortada no arquivo não volta, e diz por quê', () => {
  const nb = celula(vazio(), 'h1', 'http', 'grande', [resposta({ truncado: true, tamanho: 3 * 1024 * 1024 })]);
  const [g] = guardadosDoNotebook(nb);
  assert.equal(g.tipo, 'faltando');
  assert.match(g.tipo === 'faltando' ? g.motivo : '', /1 MB da resposta de 3 MB/);
});

test('HTTP "para cada": o arquivo guarda só o resumo, então não volta', () => {
  let nb = celula(vazio(), 'h1', 'http', 'respostas', [saidaDeTabela(['item', 'status'], [[1, 200]])]);
  nb = alterarCelula(nb, 'h1', { paraCada: 'ids' });
  const [g] = guardadosDoNotebook(nb);
  assert.equal(g.tipo, 'faltando');
  assert.match(g.tipo === 'faltando' ? g.motivo : '', /para cada/);
});

test('SQL: resultado inteiro no arquivo volta; o último resultado da célula é a variável', () => {
  const nb = celula(vazio(), 's1', 'sql', 'clientes', [
    saidaDeTabela(['id'], [[1]]),
    saidaDeTabela(['id', 'nome'], [[1, 'Ana'], [2, 'Bia']]),
  ]);
  assert.deepEqual(guardadosDoNotebook(nb), [{
    celula: 's1', nome: 'clientes', tipo: 'tabela', colunas: ['id', 'nome'], linhas: [[1, 'Ana'], [2, 'Bia']],
  }]);
});

test(`SQL: mais de ${SAIDA_MAX_LINHAS} linhas não volta, e diz quantas o arquivo tem`, () => {
  const linhas = Array.from({ length: SAIDA_MAX_LINHAS + 1 }, (_, i) => [i]);
  const nb = celula(vazio(), 's1', 'sql', 'muitos', [saidaDeTabela(['id'], linhas)]);
  const [g] = guardadosDoNotebook(nb);
  assert.equal(g.tipo, 'faltando');
  assert.match(g.tipo === 'faltando' ? g.motivo : '', /só 500 de 501 linhas/);
});

test('sem nome, sem saída, ou rodou e falhou: nada a devolver', () => {
  let nb = celula(vazio(), 's1', 'sql', 'nunca', []);
  nb = celula(nb, 'h1', 'http', 'caiu', [{ tipo: 'erro', mensagem: 'A requisição falhou: ECONNREFUSED' }]);
  nb = celula(nb, 'c1', 'codigo', null, [{ tipo: 'texto', fluxo: 'saida', texto: '1\n' }]);
  assert.deepEqual(guardadosDoNotebook(nb), []);
});

test('o mesmo nome em duas células: vale a de baixo, como rodando de cima para baixo', () => {
  let nb = celula(vazio(), 'h1', 'http', 'r', [resposta({ corpo: '{"v":1}' })]);
  nb = celula(nb, 'h2', 'http', 'r', [resposta({ corpo: '{"v":2}' })]);
  const g = guardadosDoNotebook(nb);
  assert.equal(g.length, 1);
  assert.equal(g[0].celula, 'h2');
  assert.deepEqual(g[0].tipo === 'valor' ? (g[0].valor as { body: unknown }).body : null, { v: 2 });
});

test('lerGuardados: o motor aceita só o que tem forma, e descarta o resto', () => {
  const bons = [
    { celula: 'a', nome: 'r', tipo: 'valor', valor: { x: 1 } },
    { celula: 'b', nome: 't', tipo: 'tabela', colunas: ['id'], linhas: [[1]] },
    { celula: 'c', nome: 'f', tipo: 'faltando', motivo: 'cortado' },
  ];
  const ruins = [
    null, 'x', { celula: 'd', nome: '1ruim', tipo: 'valor', valor: 1 },
    { celula: 'e', nome: 't2', tipo: 'tabela', colunas: 'id', linhas: [] },
    { celula: 'f', nome: 't3', tipo: 'tabela', colunas: ['id'], linhas: [1] },
    { celula: 'g', nome: 'z', tipo: 'outro' },
  ];
  assert.deepEqual(lerGuardados([...bons, ...ruins]), bons);
  assert.deepEqual(lerGuardados({ nao: 'lista' }), []);
});
