// O pedido que vai ao motor quando um bloco roda.
//
// A cópia à mão deste pedido, na aba de caderno da extensão, esqueceu o `mode`
// e derrubou todo bloco que não fosse SQL. Aqui a decisão é uma só, e provada.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LINHAS_POR_PAGINA,
  pedidoAoRunner,
  pedidoDeConsulta,
} from '../sql/pedido-de-execucao';

test('bloco do runner leva `mode`, que é o campo que a rota exige', () => {
  assert.deepEqual(pedidoAoRunner('python', 'print(1)'), {
    mode: 'block',
    language: 'python',
    code: 'print(1)',
  });
});

test('a primeira página não manda offset', () => {
  const p = pedidoDeConsulta('SELECT 1', 'acme');
  assert.deepEqual(p, { statement: 'SELECT 1', database: 'acme', rowLimit: LINHAS_POR_PAGINA });
  assert.equal('offset' in p, false);
});

test('a página 3 pula duas páginas inteiras', () => {
  assert.equal(pedidoDeConsulta('SELECT 1', 'acme', 3).offset, 2 * LINHAS_POR_PAGINA);
});

test('página abaixo de 1, ou quebrada, cai na primeira — sem offset negativo', () => {
  for (const pagina of [0, -4, 0.5]) {
    assert.equal(pedidoDeConsulta('SELECT 1', 'acme', pagina).offset, undefined, String(pagina));
  }
  assert.equal(pedidoDeConsulta('SELECT 1', 'acme', 2.7).offset, LINHAS_POR_PAGINA);
});
