// A célula SQL "para cada item" (spec 114, B), com uma execução de mentira.
//
// O caso dele: "se me passarem uma lista de ids… eu preciso rodar a function
// ModoBusca para cada uma delas… no SQL eu queria fazer tipo um for each".
// Decisão: um item que falha PARA a célula ali (como o sql() e o Rodar tudo),
// e o recado diz qual — os anteriores já valeram.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rodarParaCada } from '../notebook/para-cada';
import type { QueryResult } from '../../shared/contracts';

const resultado = (colunas: string[], linhas: unknown[][], message?: string): QueryResult => ({
  columns: colunas.map((name) => ({ name })), rows: linhas as QueryResult['rows'],
  rowCount: linhas.length, durationMs: 0, truncated: false, ...(message === undefined ? {} : { message }),
});

test('SELECT por item: UMA tabela, com a coluna item na frente', async () => {
  const vistos: unknown[][] = [];
  const r = await rodarParaCada({
    itens: [{ id: 10 }, { id: 20 }],
    texto: 'SELECT ModoBusca({{item.id}}, 1) AS r',
    outros: {},
    estilo: 'interrogacao',
    executar: async (sql, params) => { vistos.push([sql, ...params]); return resultado(['r'], [[Number(params[0]) * 2]]); },
    parar: () => false,
    aoProgresso: () => undefined,
  });
  assert.deepEqual(vistos, [['SELECT ModoBusca(?, 1) AS r', 10], ['SELECT ModoBusca(?, 1) AS r', 20]]);
  assert.deepEqual(r.colunas, ['item', 'r']);
  assert.deepEqual(r.linhas, [[1, 20], [2, 40]]);
  assert.equal(r.falha, null);
  // SELECT não escreve: nada de "0 linhas afetadas" no resumo.
  assert.equal(r.escritas, 0);
});

test('{{item}} sozinho é o próprio item (lista de ids)', async () => {
  const params: unknown[] = [];
  await rodarParaCada({
    itens: [101, 102], texto: 'UPDATE t SET x = 1 WHERE id = {{item}}', outros: {}, estilo: 'dolar',
    executar: async (_s, p) => { params.push(...p); return resultado([], [], '1 linha(s) afetada(s).'); },
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.deepEqual(params, [101, 102]);
});

test('escrita: soma as linhas afetadas; banco que não conta → null', async () => {
  const conta = await rodarParaCada({
    itens: [1, 2, 3], texto: 'UPDATE t SET x = {{item}}', outros: {}, estilo: 'interrogacao',
    // Numa escrita, rowCount é o que o banco afetou (não as linhas devolvidas).
    executar: async () => ({ ...resultado([], [], '2 linha(s) afetada(s).'), rowCount: 2 }),
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.equal(conta.comandos, 3);
  assert.equal(conta.linhasAfetadas, 6);
  const naoConta = await rodarParaCada({
    itens: [1], texto: 'UPDATE t SET x = {{item}}', outros: {}, estilo: 'dolar',
    executar: async () => resultado([], [], 'Comando executado.'),
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.equal(naoConta.linhasAfetadas, null);
});

test('um item falha: PARA ali, diz qual, e o que veio antes fica', async () => {
  const r = await rodarParaCada({
    itens: [{ id: 1 }, { id: 2 }, { id: 3 }], texto: 'SELECT {{item.id}} AS n', outros: {}, estilo: 'interrogacao',
    executar: async (_s, p) => {
      if (p[0] === 2) throw new Error('erro do banco');
      return resultado(['n'], [[p[0]]]);
    },
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.deepEqual(r.linhas, [[1, 1]]);
  assert.deepEqual(r.falha, { item: 2, mensagem: 'erro do banco' });
  assert.equal(r.comandos, 1);
});

test('Parar: para ENTRE um item e outro', async () => {
  let n = 0;
  const r = await rodarParaCada({
    itens: [1, 2, 3, 4], texto: 'SELECT {{item}} AS n', outros: {}, estilo: 'interrogacao',
    executar: async (_s, p) => { n += 1; return resultado(['n'], [[p[0]]]); },
    parar: () => n >= 2, aoProgresso: () => undefined,
  });
  assert.equal(n, 2);
  assert.equal(r.parado, true);
});

test('o progresso conta item a item', async () => {
  const passos: string[] = [];
  await rodarParaCada({
    itens: ['a', 'b'], texto: 'SELECT {{item}}', outros: {}, estilo: 'interrogacao',
    executar: async () => resultado(['x'], [[1]]),
    parar: () => false, aoProgresso: (feitos, total) => passos.push(`${feitos}/${total}`),
  });
  assert.deepEqual(passos, ['0/2', '1/2', '2/2']);
});

test('os outros {{ }} continuam valendo junto do item', async () => {
  const params: unknown[] = [];
  await rodarParaCada({
    itens: [7], texto: 'SELECT ModoBusca({{item}}, {{modo}})', outros: { modo: 3 }, estilo: 'interrogacao',
    executar: async (_s, p) => { params.push(...p); return resultado(['r'], [[1]]); },
    parar: () => false, aoProgresso: () => undefined,
  });
  assert.deepEqual(params, [7, 3]);
});
