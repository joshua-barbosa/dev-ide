// Ler gatilho e checagem do texto do SQLite (T063, spec 069).
//
// O que erra aqui é achar `CHECK` onde ele não é comando: dentro de uma string,
// de um comentário, de um nome de coluna. Por isso a máscara vem primeiro, e
// é ela que este arquivo testa mais.
import test from 'node:test';
import assert from 'node:assert/strict';

import { lerChecagens, lerGatilho, mascarar } from '../sql/sqlite-ddl';

test('a máscara apaga literal e comentário, e preserva o comprimento', () => {
  const texto = "a 'b' -- c\nd";
  const m = mascarar(texto);
  assert.equal(m.length, texto.length);
  assert.equal(m, 'a         \nd');
});

test('aspa dobrada não termina o literal', () => {
  const texto = "x 'não''sei' y";
  assert.equal(mascarar(texto), 'x            y');
});

test('colchete e crase também são citação no SQLite', () => {
  assert.equal(mascarar('a [b c] d'), 'a       d');
  assert.equal(mascarar('a `b c` d'), 'a       d');
});

test('lê o gatilho: nome, momento, evento e corpo', () => {
  const g = lerGatilho(
    'CREATE TRIGGER tg_audita AFTER INSERT ON alunos\nFOR EACH ROW\nBEGIN\n  INSERT INTO log VALUES (NEW.id);\nEND'
  );
  assert.equal(g?.nome, 'tg_audita');
  assert.equal(g?.momento, 'AFTER');
  assert.equal(g?.evento, 'INSERT');
  assert.equal(g?.orientacao, 'ROW');
  assert.match(g?.corpo ?? '', /INSERT INTO log VALUES \(NEW\.id\);/);
});

test('INSTEAD OF e IF NOT EXISTS também são lidos', () => {
  const g = lerGatilho(
    'CREATE TRIGGER IF NOT EXISTS "tg x" INSTEAD OF UPDATE ON v BEGIN SELECT 1; END'
  );
  assert.equal(g?.nome, 'tg x');
  assert.equal(g?.momento, 'INSTEAD OF');
  assert.equal(g?.evento, 'UPDATE');
});

test('texto que não é gatilho devolve null, e não um gatilho em branco', () => {
  assert.equal(lerGatilho('CREATE TABLE t (id int)'), null);
  assert.equal(lerGatilho(''), null);
});

test('lê a checagem da COLUNA e a da TABELA', () => {
  const r = lerChecagens(
    'CREATE TABLE alunos (\n' +
      '  id INTEGER PRIMARY KEY,\n' +
      '  idade INTEGER CHECK (idade > 0),\n' +
      '  nome TEXT,\n' +
      '  CONSTRAINT ck_nome CHECK (length(nome) > 2)\n' +
      ')'
  );
  assert.ok('itens' in r);
  assert.deepEqual(
    r.itens.map((c) => [c.nome, c.expressao]),
    [
      ['(coluna idade)', 'idade > 0'],
      ['ck_nome', 'length(nome) > 2'],
    ]
  );
});

test('CHECK dentro de string ou comentário NÃO conta', () => {
  const r = lerChecagens(
    "CREATE TABLE t (\n" +
      "  rotulo TEXT DEFAULT 'CHECK (isto e texto)',\n" +
      '  -- CHECK (isto e comentario)\n' +
      '  id INTEGER\n' +
      ')'
  );
  assert.ok('itens' in r);
  assert.deepEqual(r.itens, []);
});

test('parênteses aninhados na expressão não confundem a varredura', () => {
  const r = lerChecagens('CREATE TABLE t (a INT, CHECK (a IN (1, 2, (3))))');
  assert.ok('itens' in r);
  assert.equal(r.itens[0]?.expressao, 'a IN (1, 2, (3))');
});

test('o que não dá para ler volta como naoSei, e não como lista vazia', () => {
  // A distinção da spec 045: "não tem checagem" e "não consegui ler" são
  // coisas diferentes, e mostrá-las igual é a tela afirmando o que não sabe.
  const semParenteses = lerChecagens('CREATE TABLE t');
  assert.ok('naoSei' in semParenteses);
  const semPar = lerChecagens('CREATE TABLE t (a INT, CHECK (a > 0)');
  assert.ok('naoSei' in semPar);
});
