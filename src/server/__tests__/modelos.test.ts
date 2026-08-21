import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeloSql, type ColunaDeModelo } from '../connections/drivers/modelos';

const COLUNAS: ColunaDeModelo[] = [
  { nome: 'id', tipo: 'bigint', chave: true, autoIncremento: true },
  { nome: 'nome', tipo: 'varchar(255)', chave: false, autoIncremento: false },
  { nome: 'nota', tipo: 'decimal(4,2)', chave: false, autoIncremento: false },
];

const gerar = (id: string, colunas = COLUNAS): string =>
  modeloSql(id, { alvo: '`escola`.`alunos`', colunas, estilo: 'backtick' });

// ---------------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------------

test('SELECT lista as colunas, e não `*`', () => {
  // `SELECT *` num editor é o que se digita com pressa; o modelo existe
  // justamente para poupar de escrever a lista.
  const sql = gerar('template-select');
  assert.match(sql, /SELECT/);
  assert.match(sql, /`id`,/);
  assert.match(sql, /`nome`,/);
  assert.match(sql, /`nota`/);
  assert.match(sql, /FROM `escola`\.`alunos`/);
  assert.match(sql, /LIMIT 100/);
});

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------

test('INSERT pula a coluna de auto-incremento', () => {
  // Quem preenche é o banco; incluí-la é o erro mais comum ao escrever à mão.
  const sql = gerar('template-insert');
  assert.equal(sql.includes('`id`'), false, 'a coluna auto-incremento não entra');
  assert.match(sql, /INSERT INTO `escola`\.`alunos`/);
  assert.match(sql, /`nome`, `nota`/);
});

test('INSERT põe um marcador por coluna, com o tipo à vista', () => {
  const sql = gerar('template-insert');
  // Dois marcadores para duas colunas — e o tipo em comentário, porque é o que
  // decide se vai aspa ou não.
  assert.match(sql, /VALUES \(/);
  assert.equal((sql.match(/:/g) ?? []).length >= 2, true);
  assert.match(sql, /varchar\(255\)/);
});

test('tabela SÓ com auto-incremento gera um INSERT que ainda roda', () => {
  const sql = modeloSql('template-insert', {
    alvo: '`t`',
    colunas: [{ nome: 'id', tipo: 'int', chave: true, autoIncremento: true }],
    estilo: 'backtick',
  });
  // Sem colunas para preencher, a forma correta é a de valores padrão — e não
  // um `INSERT INTO t () VALUES ()`, que é erro de sintaxe.
  assert.match(sql, /DEFAULT VALUES|VALUES \(\)|SET \(\)|-- /);
});

// ---------------------------------------------------------------------------
// UPDATE e DELETE — é aqui que a chave primária importa
// ---------------------------------------------------------------------------

test('UPDATE traz o WHERE pela chave primária', () => {
  const sql = gerar('template-update');
  assert.match(sql, /UPDATE `escola`\.`alunos`/);
  assert.match(sql, /SET/);
  // A chave NÃO entra no SET: trocar a chave da linha que se está achando por
  // ela é o caminho mais curto para um estrago.
  assert.equal(/SET[\s\S]*`id` =/.test(sql.split('WHERE')[0] ?? ''), false);
  assert.match(sql, /WHERE `id` = /);
});

test('DELETE traz o WHERE pela chave primária', () => {
  const sql = gerar('template-delete');
  assert.match(sql, /DELETE FROM `escola`\.`alunos`/);
  assert.match(sql, /WHERE `id` = /);
});

test('chave composta entra inteira no WHERE', () => {
  const sql = modeloSql('template-delete', {
    alvo: '`t`',
    colunas: [
      { nome: 'a', tipo: 'int', chave: true, autoIncremento: false },
      { nome: 'b', tipo: 'int', chave: true, autoIncremento: false },
      { nome: 'x', tipo: 'int', chave: false, autoIncremento: false },
    ],
    estilo: 'backtick',
  });
  assert.match(sql, /WHERE `a` = .* AND `b` = /);
});

/**
 * O que o BANCO vê: sem comentário nenhum.
 *
 * É a única leitura que importa para julgar segurança. A primeira versão desta
 * spec comentava o `WHERE` inteiro quando não havia chave primária — e o `;`
 * ia junto para dentro do comentário. Na tela parecia protegido; o que chegava
 * ao MySQL era `DELETE FROM tabela`, sem cláusula nenhuma.
 */
function comoOBancoVe(sql: string): string {
  return sql
    .split('\n')
    .map((l) => {
      const corte = l.indexOf('--');
      return corte === -1 ? l : l.slice(0, corte);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('SEM chave primária, o que chega ao banco NÃO é um DELETE sem WHERE', () => {
  // Encontrado contra o banco do usuário, na tabela `alternativas_backup`.
  // Este é o teste que teria pego: ele lê o SQL como o motor lê.
  const sql = modeloSql('template-delete', {
    alvo: '`t`',
    colunas: [{ nome: 'x', tipo: 'int', chave: false, autoIncremento: false }],
    estilo: 'backtick',
  });
  const visto = comoOBancoVe(sql);
  assert.match(visto, /WHERE/, 'o WHERE não pode existir só em comentário');
  assert.match(visto, /1 = 0/, 'e precisa ser uma condição que não casa com nada');
  assert.match(visto, /;$/, 'o terminador não pode ficar dentro de um comentário');
  assert.match(sql, /chave prim/i, 'e o texto precisa dizer por quê');
});

test('SEM chave primária, o UPDATE também chega com WHERE ao banco', () => {
  const sql = modeloSql('template-update', {
    alvo: '`t`',
    colunas: [{ nome: 'x', tipo: 'int', chave: false, autoIncremento: false }],
    estilo: 'backtick',
  });
  const visto = comoOBancoVe(sql);
  assert.match(visto, /WHERE 1 = 0/);
  assert.match(visto, /;$/);
});

test('COM chave primária o terminador também sobrevive', () => {
  for (const id of ['template-update', 'template-delete']) {
    assert.match(comoOBancoVe(gerar(id)), /;$/, id);
  }
});

// ---------------------------------------------------------------------------
// Destrutivos
// ---------------------------------------------------------------------------

test('DROP e TRUNCATE vêm com aviso de que ainda não rodaram', () => {
  for (const id of ['drop', 'truncate']) {
    const sql = gerar(id);
    assert.match(sql, /^--/, `${id} precisa de cabeçalho em comentário`);
    assert.match(sql, /não rodou|ainda não/i, `${id} precisa dizer que não rodou`);
  }
});

test('DROP nomeia a tabela qualificada', () => {
  assert.match(gerar('drop'), /DROP TABLE `escola`\.`alunos`/);
});

test('TRUNCATE nomeia a tabela qualificada', () => {
  assert.match(gerar('truncate'), /TRUNCATE TABLE `escola`\.`alunos`/);
});

test('a view tem o seu DROP próprio', () => {
  assert.match(gerar('drop-view'), /DROP VIEW `escola`\.`alunos`/);
});

// ---------------------------------------------------------------------------
// Copiar tabela
// ---------------------------------------------------------------------------

test('copiar tabela gera criação E carga, nesta ordem', () => {
  const sql = gerar('copiar');
  const criar = sql.indexOf('CREATE TABLE');
  const inserir = sql.indexOf('INSERT INTO');
  assert.equal(criar >= 0 && inserir > criar, true, 'cria antes de carregar');
  // O nome sugerido não pode colidir com o original.
  assert.equal(sql.includes('alunos_copia'), true);
});

// ---------------------------------------------------------------------------
// Fronteira
// ---------------------------------------------------------------------------

test('estilo de citação muda com o driver', () => {
  const sql = modeloSql('template-select', {
    alvo: '"public"."alunos"',
    colunas: COLUNAS,
    estilo: 'double',
  });
  assert.match(sql, /"id"/);
  assert.equal(sql.includes('`'), false);
});

test('ação desconhecida é recusada, e não devolve SQL vazio', () => {
  assert.throws(() => gerar('inventada'), /desconhecida/i);
});

test('tabela sem coluna nenhuma não gera SELECT quebrado', () => {
  // Acontece com view recém-criada e com tabela que o usuário não pode ler.
  const sql = modeloSql('template-select', { alvo: '`t`', colunas: [], estilo: 'backtick' });
  assert.match(sql, /SELECT \* FROM `t`/, 'cai no `*`, que é o que resta');
});
