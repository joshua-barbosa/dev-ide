import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LINHAS_POR_GRAVACAO,
  montarEscrita,
  normalizarEscrita,
} from '../connections/drivers/escrita';

const COLUNAS = [
  { name: 'id', chave: true },
  { name: 'nome', chave: false },
  { name: 'nota', chave: false },
];
const alvo = { alvo: '`escola`.`alunos`', colunas: COLUNAS, estilo: 'backtick' as const };

const montar = (bruto: Record<string, unknown>) =>
  montarEscrita(alvo, normalizarEscrita(bruto, COLUNAS));

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

test('alterar uma célula vira UPDATE com a chave E o valor antigo no WHERE', () => {
  // O valor antigo é o que detecta alteração concorrente sem trava nenhuma.
  const [cmd] = montar({
    alteracoes: [{ chave: { id: 1 }, antes: { nome: 'ana' }, depois: { nome: 'bruno' } }],
  }).comandos;
  assert.match(cmd?.sql ?? '', /^UPDATE `escola`\.`alunos`\s+SET `nome` = \?/);
  assert.match(cmd?.sql ?? '', /WHERE `id` = \? AND `nome` = \?/);
  assert.deepEqual(cmd?.params, ['bruno', 1, 'ana']);
});

test('duas colunas na mesma linha viram UM UPDATE', () => {
  const { comandos } = montar({
    alteracoes: [{
      chave: { id: 1 },
      antes: { nome: 'a', nota: 5 },
      depois: { nome: 'b', nota: 6 },
    }],
  });
  assert.equal(comandos.length, 1);
  assert.match(comandos[0]?.sql ?? '', /SET `nome` = \?, `nota` = \?/);
});

test('o valor antigo NULL vira IS NULL, e não `= NULL`', () => {
  // `coluna = NULL` nunca casa, nem quando a coluna é nula. O UPDATE afetaria
  // zero linhas e a IDE acusaria conflito onde não há.
  const [cmd] = montar({
    alteracoes: [{ chave: { id: 1 }, antes: { nome: null }, depois: { nome: 'x' } }],
  }).comandos;
  assert.match(cmd?.sql ?? '', /AND `nome` IS NULL/);
  assert.deepEqual(cmd?.params, ['x', 1]);
});

test('gravar NULL é diferente de gravar texto vazio', () => {
  const nulo = montar({
    alteracoes: [{ chave: { id: 1 }, antes: { nome: 'x' }, depois: { nome: null } }],
  }).comandos[0];
  const vazio = montar({
    alteracoes: [{ chave: { id: 1 }, antes: { nome: 'x' }, depois: { nome: '' } }],
  }).comandos[0];
  assert.deepEqual(nulo?.params, [null, 1, 'x']);
  assert.deepEqual(vazio?.params, ['', 1, 'x']);
});

test('chave composta entra inteira no WHERE', () => {
  const colunas = [
    { name: 'a', chave: true }, { name: 'b', chave: true }, { name: 'x', chave: false },
  ];
  const [cmd] = montarEscrita(
    { alvo: '`t`', colunas, estilo: 'backtick' },
    normalizarEscrita(
      { alteracoes: [{ chave: { a: 1, b: 2 }, antes: { x: 'v' }, depois: { x: 'w' } }] },
      colunas
    )
  ).comandos;
  assert.match(cmd?.sql ?? '', /WHERE `a` = \? AND `b` = \? AND `x` = \?/);
  assert.deepEqual(cmd?.params, ['w', 1, 2, 'v']);
});

// ---------------------------------------------------------------------------
// INSERT e DELETE
// ---------------------------------------------------------------------------

test('linha nova vira INSERT só com as colunas preenchidas', () => {
  // Mandar as vazias como NULL sobrescreveria o DEFAULT da coluna.
  const [cmd] = montar({ insercoes: [{ nome: 'novo' }] }).comandos;
  assert.match(cmd?.sql ?? '', /INSERT INTO `escola`\.`alunos` \(`nome`\)\s+VALUES \(\?\)/);
  assert.deepEqual(cmd?.params, ['novo']);
});

test('linha nova sem nada preenchido é ignorada, não vira INSERT vazio', () => {
  assert.equal(montar({ insercoes: [{}] }).comandos.length, 0);
});

test('apagar vira DELETE pela chave', () => {
  const [cmd] = montar({ remocoes: [{ chave: { id: 7 } }] }).comandos;
  assert.match(cmd?.sql ?? '', /DELETE FROM `escola`\.`alunos`\s+WHERE `id` = \?/);
  assert.deepEqual(cmd?.params, [7]);
});

test('a ordem é apagar, alterar e inserir', () => {
  // Apagar primeiro libera chave única para um INSERT que a reaproveite.
  const { comandos } = montar({
    insercoes: [{ nome: 'c' }],
    alteracoes: [{ chave: { id: 1 }, antes: { nome: 'a' }, depois: { nome: 'b' } }],
    remocoes: [{ chave: { id: 2 } }],
  });
  assert.deepEqual(
    comandos.map((c) => c.sql.split(' ')[0]),
    ['DELETE', 'UPDATE', 'INSERT']
  );
});

// ---------------------------------------------------------------------------
// A fronteira — é aqui que um nome vindo da tela viraria SQL
// ---------------------------------------------------------------------------

test('coluna inventada é RECUSADA em qualquer um dos três', () => {
  for (const bruto of [
    { alteracoes: [{ chave: { id: 1 }, antes: { x: 1 }, depois: { x: 2 } }] },
    { insercoes: [{ x: 1 }] },
    { remocoes: [{ chave: { x: 1 } }] },
  ]) {
    assert.throws(() => normalizarEscrita(bruto, COLUNAS), /coluna/i, JSON.stringify(bruto));
  }
});

test('alterar a CHAVE é recusado', () => {
  // Trocar a chave da linha que se está achando por ela é o caminho mais curto
  // para um estrago.
  assert.throws(
    () => normalizarEscrita(
      { alteracoes: [{ chave: { id: 1 }, antes: { id: 1 }, depois: { id: 2 } }] },
      COLUNAS
    ),
    /chave/i
  );
});

test('alteração sem a chave inteira é recusada', () => {
  const colunas = [{ name: 'a', chave: true }, { name: 'b', chave: true }, { name: 'x', chave: false }];
  assert.throws(
    () => normalizarEscrita(
      { alteracoes: [{ chave: { a: 1 }, antes: { x: 1 }, depois: { x: 2 } }] },
      colunas
    ),
    /chave/i
  );
});

test('tabela SEM chave primária recusa qualquer escrita', () => {
  const semChave = [{ name: 'x', chave: false }];
  assert.throws(
    () => normalizarEscrita({ remocoes: [{ chave: { x: 1 } }] }, semChave),
    /chave prim/i
  );
});

test('valor nunca aparece no SQL, nem o mais hostil', () => {
  const [cmd] = montar({
    alteracoes: [{
      chave: { id: 1 },
      antes: { nome: 'a' },
      depois: { nome: "'; DROP TABLE alunos; --" },
    }],
  }).comandos;
  assert.equal(cmd?.sql.includes('DROP'), false);
  assert.equal(cmd?.params.includes("'; DROP TABLE alunos; --"), true);
});

test('rascunho acima do teto é recusado', () => {
  const muitas = Array.from({ length: MAX_LINHAS_POR_GRAVACAO + 1 }, (_, i) => ({
    chave: { id: i },
  }));
  assert.throws(() => normalizarEscrita({ remocoes: muitas }, COLUNAS), /limite|teto|muitas/i);
});

test('rascunho vazio não gera comando nenhum', () => {
  assert.deepEqual(montar({}).comandos, []);
});
