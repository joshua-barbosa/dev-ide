import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_LINHAS_EXPORTADAS, varrerTabela } from '../connections/exportacao';
import type { TablePage, TableRequest } from '../../shared/contracts';

/** Um banco de mentira com `total` linhas, que responde como o `readTable`. */
function bancoCom(total: number) {
  const idas: TableRequest[] = [];
  const ler = async (r: TableRequest): Promise<TablePage> => {
    idas.push(r);
    const inicio = (r.pagina - 1) * r.porPagina;
    const rows = Array.from(
      { length: Math.max(0, Math.min(r.porPagina, total - inicio)) },
      (_, i) => [inicio + i + 1, `linha ${inicio + i + 1}`] as const
    );
    return {
      resultado: { columns: [{ name: 'id' }, { name: 'nome' }], rows, rowCount: rows.length, durationMs: 1, truncated: false },
      columns: [
        { name: 'id', type: 'INTEGER', chave: true, obrigatoria: true },
        { name: 'nome', type: 'TEXT', chave: false, obrigatoria: false },
      ],
      total, totalEstimado: null, sql: '',
    } as unknown as TablePage;
  };
  return { ler, idas };
}

const PEDIDO = { nodePath: ['c', 'db', 'Tables', 't'], ordenar: null, filtros: [] };

test('traz TODAS as linhas, e não só a primeira página', async () => {
  const { ler } = bancoCom(2500);
  const r = await varrerTabela(ler, PEDIDO);
  assert.equal(r.rows.length, 2500);
  assert.equal(r.truncado, false);
});

test('para quando o lote vem incompleto, sem uma ida a mais ao banco', async () => {
  const { ler, idas } = bancoCom(1500);
  await varrerTabela(ler, PEDIDO);
  // 1000 + 500: a segunda já é incompleta e encerra. Uma terceira seria uma
  // viagem ao servidor para receber zero linhas.
  assert.equal(idas.length, 2);
});

test('tabela exatamente do tamanho do lote pede mais uma vez, e para', async () => {
  const { ler, idas } = bancoCom(1000);
  const r = await varrerTabela(ler, PEDIDO);
  assert.equal(r.rows.length, 1000);
  // Aqui a ida extra é NECESSÁRIA: um lote cheio não distingue "acabou" de
  // "tem mais".
  assert.equal(idas.length, 2);
});

test('tabela vazia devolve zero linhas e as colunas', async () => {
  const { ler } = bancoCom(0);
  const r = await varrerTabela(ler, PEDIDO);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.columns.map((c) => c.name), ['id', 'nome']);
});

test('o teto corta e AVISA — travar a aba seria resposta pior', async () => {
  const { ler } = bancoCom(MAX_LINHAS_EXPORTADAS + 5000);
  const r = await varrerTabela(ler, PEDIDO);
  assert.equal(r.rows.length, MAX_LINHAS_EXPORTADAS);
  assert.equal(r.truncado, true);
});

test('os filtros e a ordem da tela vão em TODOS os lotes', async () => {
  const { ler, idas } = bancoCom(2500);
  await varrerTabela(ler, {
    nodePath: ['c'],
    ordenar: { coluna: 'id', desc: true },
    filtros: [{ coluna: 'nome', valor: '>10' }],
  });
  // Sem isso, a página 2 traria linhas de um conjunto diferente da página 1.
  for (const ida of idas) {
    assert.deepEqual(ida.ordenar, { coluna: 'id', desc: true });
    assert.deepEqual(ida.filtros, [{ coluna: 'nome', valor: '>10' }]);
  }
});
