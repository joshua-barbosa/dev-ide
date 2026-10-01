// A aba da extensão identificada pelo ALVO, e não pelo título.
//
// O defeito: a mesma tabela em dois databases, e a segunda não abria — só
// revelava a primeira, porque as duas tinham o título `mesma_tabela`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { chaveDaAba, tituloDaAba } from '../extensao/chave-da-aba';

const tabela = (database: string, connectionId = 'c1') => ({
  connectionId,
  database,
  nodePath: [database, 'tables', 'clientes'],
});

test('a mesma tabela em dois databases são duas abas', () => {
  assert.notEqual(
    chaveDaAba('tabela', 'clientes', tabela('loja_a')),
    chaveDaAba('tabela', 'clientes', tabela('loja_b'))
  );
});

test('a mesma tabela em duas conexões são duas abas', () => {
  assert.notEqual(
    chaveDaAba('tabela', 'clientes', tabela('loja_a', 'c1')),
    chaveDaAba('tabela', 'clientes', tabela('loja_a', 'c2'))
  );
});

test('reabrir a mesma tabela é a mesma aba', () => {
  assert.equal(
    chaveDaAba('tabela', 'clientes', tabela('loja_a')),
    chaveDaAba('tabela', 'clientes', tabela('loja_a'))
  );
});

test('a chave Redis de mesmo nome em duas conexões são duas abas', () => {
  assert.notEqual(
    chaveDaAba('chave', 'sessao:1', { conexaoId: 'r1', chave: 'sessao:1' }),
    chaveDaAba('chave', 'sessao:1', { conexaoId: 'r2', chave: 'sessao:1' })
  );
});

test('dois servidores com o mesmo rótulo são duas abas', () => {
  assert.notEqual(
    chaveDaAba('servidor', 'web', { conexaoId: 's1', rotulo: 'web' }),
    chaveDaAba('servidor', 'web', { conexaoId: 's2', rotulo: 'web' })
  );
  assert.notEqual(
    chaveDaAba('processos', 'Processos — web', { conexaoId: 's1' }),
    chaveDaAba('processos', 'Processos — web', { conexaoId: 's2' })
  );
});

test('o resultado continua caindo sempre na mesma aba pelo título', () => {
  assert.equal(chaveDaAba('resultado', 'consulta', { a: 1 }), chaveDaAba('resultado', 'consulta', { a: 2 }));
});

test('o título da tabela leva o database', () => {
  assert.equal(tituloDaAba('tabela', 'clientes', tabela('loja_a')), 'clientes · loja_a');
  assert.equal(tituloDaAba('tabela', 'loja_a', tabela('loja_a')), 'loja_a');
  assert.equal(tituloDaAba('tabela', 'x', { database: '' }), 'x');
  assert.equal(tituloDaAba('servidor', 'web', { database: 'loja_a' }), 'web');
});
