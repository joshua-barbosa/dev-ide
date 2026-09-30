// Um bloco do caderno com várias instruções roda cada uma (spec 111).
//
// Ele (30/09): *"se eu coloco mais de uma query dentro de um bloco, ele da
// erro... O que deveria acontecer, se tem mais de uma query (e é bem nitido que
// tem, pois termina com ; cada query), deveria rodar e gerar uma tela
// "Results" para cada query."*
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instrucoesDoBloco, tituloDaInstrucao, vagaDaInstrucao } from '../sql/instrucoes-do-bloco';

test('uma instrução só segue INTACTA, como sempre foi', () => {
  // Sem `;` no fim, com comentário, com espaço: nada muda para quem já usava.
  const bloco = '-- as provas\nSELECT * FROM provas\n';
  assert.deepEqual(instrucoesDoBloco(bloco), { instrucoes: [bloco], erro: null });
});

test('duas queries viram duas instruções', () => {
  const r = instrucoesDoBloco('SELECT 1;\nSELECT 2;');
  assert.deepEqual(r.instrucoes, ['SELECT 1', 'SELECT 2']);
});

test('ponto e vírgula DENTRO de texto não parte a query', () => {
  const r = instrucoesDoBloco("SELECT 'a;b';\nSELECT 2;");
  assert.deepEqual(r.instrucoes, ["SELECT 'a;b'", 'SELECT 2']);
});

test('corpo de procedure não é partido no ; de dentro', () => {
  const corpo = 'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END';
  const r = instrucoesDoBloco(`${corpo};\nCALL p();`);
  assert.deepEqual(r.instrucoes, [corpo, 'CALL p()']);
});

test('ponto e vírgula sobrando não vira instrução vazia', () => {
  assert.deepEqual(instrucoesDoBloco('SELECT 1;;\n;\nSELECT 2;').instrucoes, ['SELECT 1', 'SELECT 2']);
});

test('bloco vazio não tem o que rodar', () => {
  assert.deepEqual(instrucoesDoBloco('  \n ').instrucoes, []);
});

test('o título diz QUAL das instruções é, quando há mais de uma', () => {
  assert.equal(tituloDaInstrucao('relatorio.sqlbook', 0, 1), 'relatorio.sqlbook');
  assert.equal(tituloDaInstrucao('relatorio.sqlbook', 1, 3), 'relatorio.sqlbook · 2/3');
});

test('a vaga do resultado separa as instruções, e só quando há mais de uma', () => {
  // A IDE guarda o resultado pelo CAMINHO: sem a parte, a instrução 2 do
  // caderno apagaria a 1.
  assert.equal(vagaDaInstrucao('grid:/x.sqlbook'), 'grid:/x.sqlbook');
  assert.equal(vagaDaInstrucao('grid:/x.sqlbook', { indice: 0, total: 2 }), 'grid:/x.sqlbook:1/2');
  assert.notEqual(
    vagaDaInstrucao('grid:/x.sqlbook', { indice: 0, total: 2 }),
    vagaDaInstrucao('grid:/x.sqlbook', { indice: 1, total: 2 })
  );
});
