// Executar o `CREATE` pela árvore (T113, spec 069).
//
// O que se testa aqui é a RECUSA: quando a IDE não pode rodar o esqueleto, ela
// precisa dizer por quê antes do clique. Botão que só falha depois de apertado
// é a interface que a spec 046 já recusou uma vez.
import test from 'node:test';
import assert from 'node:assert/strict';

import { motivoParaNaoExecutar } from '../sql/criacao';

test('conexão somente-leitura não executa, e diz isso', () => {
  const motivo = motivoParaNaoExecutar('CREATE TABLE t (id int);', true);
  assert.match(motivo ?? '', /somente-leitura/i);
});

test('o esqueleto normal executa', () => {
  assert.equal(motivoParaNaoExecutar('CREATE TABLE t (id int);', false), null);
  assert.equal(motivoParaNaoExecutar('CREATE SEQUENCE s START WITH 1;', false), null);
});

test('DELIMITER não executa: é comando do CLIENTE, não do servidor', () => {
  // O esqueleto de procedure e de evento do MySQL traz `DELIMITER $$`. Mandá-lo
  // ao servidor dá erro de sintaxe, e o quebrador de statements ainda parte
  // DENTRO do corpo — que é justamente o T052, do lote B.
  const sql = 'DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;';
  const motivo = motivoParaNaoExecutar(sql, false);
  assert.match(motivo ?? '', /DELIMITER/);
});

test('a palavra delimiter DENTRO do SQL não conta', () => {
  // Só vale como comando quando abre a linha — senão um comentário ou uma
  // coluna chamada `delimiter` tirariam o botão sem motivo.
  assert.equal(
    motivoParaNaoExecutar("CREATE TABLE t (delimiter varchar(10));", false),
    null
  );
  assert.equal(motivoParaNaoExecutar('-- usa DELIMITER depois\nCREATE TABLE t (id int);', false), null);
});

test('a janela CRIA: o que apaga ou reescreve não sai daqui', () => {
  // A regra da spec 046 continua de pé. O campo é livre, e a janela se chama
  // "Criar em X" — um DROP saindo dela seria a promessa quebrada mais cara.
  for (const comando of ['DROP TABLE t;', 'TRUNCATE TABLE t;', 'ALTER TABLE t ADD c int;',
                         'DELETE FROM t;', 'UPDATE t SET a = 1;']) {
    assert.notEqual(motivoParaNaoExecutar(comando, false), null, comando);
  }
  // Mas a palavra dentro do comando não conta: uma coluna chamada `delete_at`
  // ou um DEFAULT com `alter` no texto não podem desligar o botão.
  assert.equal(motivoParaNaoExecutar('CREATE TABLE t (deleted_at timestamp);', false), null);
  assert.equal(motivoParaNaoExecutar("CREATE VIEW v AS SELECT 'drop' AS x;", false), null);
});

test('esqueleto vazio não executa', () => {
  assert.notEqual(motivoParaNaoExecutar('   \n  ', false), null);
  assert.notEqual(motivoParaNaoExecutar('-- só um comentário', false), null);
});
