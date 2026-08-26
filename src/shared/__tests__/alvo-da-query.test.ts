import assert from 'node:assert/strict';
import test from 'node:test';
import { alvoDaQuery, colunasSaoDaTabela } from '../sql/alvo-da-query';

const tabelaDe = (sql: string) => alvoDaQuery(sql).alvo?.tabela ?? null;
const motivoDe = (sql: string) => alvoDaQuery(sql).motivo;

test('SELECT simples: a tabela é inequívoca', () => {
  assert.equal(tabelaDe('select * from alunos'), 'alunos');
  assert.equal(tabelaDe('SELECT id, nome FROM alunos WHERE id = 1'), 'alunos');
  assert.equal(tabelaDe('select * from alunos a where a.id = 1'), 'alunos');
});

test('nome qualificado e citado, nos três dialetos', () => {
  assert.deepEqual(alvoDaQuery('select * from `app`.`logs`').alvo, { tabela: 'logs', schema: 'app' });
  assert.deepEqual(alvoDaQuery('select * from "public"."logs"').alvo, { tabela: 'logs', schema: 'public' });
  assert.deepEqual(alvoDaQuery('select * from app.logs').alvo, { tabela: 'logs', schema: 'app' });
});

test('JOIN não dá: montar UPDATE aí escreveria na tabela errada', () => {
  assert.equal(tabelaDe('select * from a join b on a.id = b.id'), null);
  assert.match(motivoDe('select * from a join b on a.id = b.id') ?? '', /junta mais de uma/);
});

test('vírgula no FROM é JOIN da forma antiga, e também não dá', () => {
  assert.equal(tabelaDe('select * from a, b where a.id = b.id'), null);
});

test('GROUP BY não dá: uma linha do resultado não é uma linha da tabela', () => {
  assert.equal(tabelaDe('select nome, count(*) from alunos group by nome'), null);
  assert.match(motivoDe('select nome, count(*) from alunos group by nome') ?? '', /agrupa/);
});

test('DISTINCT, UNION, HAVING e subconsulta não dão', () => {
  assert.equal(tabelaDe('select distinct nome from alunos'), null);
  assert.equal(tabelaDe('select * from a union select * from b'), null);
  assert.equal(tabelaDe('select nome from alunos group by nome having count(*) > 1'), null);
  assert.equal(tabelaDe('select * from (select * from alunos) x'), null);
});

test('o que não é SELECT não tem alvo', () => {
  assert.equal(tabelaDe('update alunos set nome = 1'), null);
  assert.equal(tabelaDe('delete from alunos'), null);
  assert.equal(tabelaDe('show tables'), null);
});

test('a palavra `join` DENTRO de um texto não conta', () => {
  // Sem tirar o conteúdo das aspas, isto seria lido como JOIN e a edição
  // sumiria de uma consulta perfeitamente editável.
  assert.equal(tabelaDe("select * from alunos where nome = 'join da silva'"), 'alunos');
});

test('a palavra `join` num comentário também não conta', () => {
  assert.equal(tabelaDe('select * from alunos -- depois fazer join com notas'), 'alunos');
  assert.equal(tabelaDe('select * /* join aqui */ from alunos'), 'alunos');
});

test('as colunas do resultado precisam ser todas da tabela', () => {
  assert.equal(colunasSaoDaTabela(['id', 'nome'], ['id', 'nome', 'nota']), true);
  // `count(*)` vem com outro nome: é o que denuncia a coluna calculada sem
  // precisar entender a expressão.
  assert.equal(colunasSaoDaTabela(['total'], ['id', 'nome']), false);
  assert.equal(colunasSaoDaTabela([], ['id']), false);
});
