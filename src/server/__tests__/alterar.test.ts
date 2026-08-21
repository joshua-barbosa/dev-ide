import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIALETOS, montarAlteracao, operacoesDisponiveis } from '../connections/drivers/alterar';

const mysql = { alvo: '`escola`.`alunos`', dialeto: DIALETOS.mysql };
const pg = { alvo: '"public"."alunos"', dialeto: DIALETOS.postgres };
const sqlite = { alvo: '"alunos"', dialeto: DIALETOS.sqlite };

const sql = (ctx: typeof mysql, op: Record<string, unknown>): string =>
  montarAlteracao(ctx, op as never);

// ---------------------------------------------------------------------------
// Renomear
// ---------------------------------------------------------------------------

test('renomear tabela, nos três dialetos', () => {
  assert.match(sql(mysql, { tipo: 'renomear-tabela', novo: 'alunos2' }), /RENAME TO `alunos2`/);
  assert.match(sql(pg, { tipo: 'renomear-tabela', novo: 'alunos2' }), /RENAME TO "alunos2"/);
  assert.match(sql(sqlite, { tipo: 'renomear-tabela', novo: 'alunos2' }), /RENAME TO "alunos2"/);
});

test('renomear coluna', () => {
  const op = { tipo: 'renomear-coluna', coluna: 'nome', novo: 'nome_completo' };
  assert.match(sql(mysql, op), /RENAME COLUMN `nome` TO `nome_completo`/);
  assert.match(sql(sqlite, op), /RENAME COLUMN "nome" TO "nome_completo"/);
});

// ---------------------------------------------------------------------------
// Coluna
// ---------------------------------------------------------------------------

test('acrescentar coluna leva tipo, obrigatoriedade e padrão', () => {
  const gerado = sql(mysql, {
    tipo: 'acrescentar-coluna',
    coluna: 'idade',
    tipoSql: 'int',
    obrigatoria: true,
    padrao: '0',
  });
  assert.match(gerado, /ADD COLUMN `idade` int NOT NULL DEFAULT 0/);
});

test('coluna sem padrão não ganha DEFAULT', () => {
  const gerado = sql(mysql, {
    tipo: 'acrescentar-coluna',
    coluna: 'x',
    tipoSql: 'int',
    obrigatoria: false,
    padrao: null,
  });
  assert.equal(gerado.includes('DEFAULT'), false);
  assert.equal(gerado.includes('NOT NULL'), false);
});

test('padrão de texto vai como literal escapado', () => {
  // Vem de um campo de formulário: aspa dentro não pode fechar o literal.
  const gerado = sql(mysql, {
    tipo: 'acrescentar-coluna',
    coluna: 'x',
    tipoSql: 'varchar(10)',
    obrigatoria: false,
    padrao: "d'agua",
  });
  assert.match(gerado, /DEFAULT 'd''agua'/);
});

test('alterar coluna usa o verbo de CADA dialeto', () => {
  const op = {
    tipo: 'alterar-coluna',
    coluna: 'nome',
    tipoSql: 'varchar(500)',
    obrigatoria: true,
    padrao: null,
  };
  // MySQL redeclara a coluna inteira; PostgreSQL muda um aspecto por vez.
  assert.match(sql(mysql, op), /MODIFY COLUMN `nome` varchar\(500\) NOT NULL/);
  const doPg = sql(pg, op);
  assert.match(doPg, /ALTER COLUMN "nome" TYPE varchar\(500\)/);
  assert.match(doPg, /ALTER COLUMN "nome" SET NOT NULL/);
});

test('apagar coluna avisa que reescreve a tabela', () => {
  const gerado = sql(mysql, { tipo: 'apagar-coluna', coluna: 'nome' });
  assert.match(gerado, /^--/);
  assert.match(gerado, /ainda NÃO rodou/i);
  assert.match(gerado, /DROP COLUMN `nome`/);
});

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

test('criar índice simples e único', () => {
  assert.match(
    sql(mysql, { tipo: 'criar-indice', nome: 'idx_nome', colunas: ['nome'], unico: false }),
    /CREATE INDEX `idx_nome`\s+ON `escola`\.`alunos` \(`nome`\)/
  );
  assert.match(
    sql(mysql, { tipo: 'criar-indice', nome: 'u_nome', colunas: ['nome'], unico: true }),
    /CREATE UNIQUE INDEX/
  );
});

test('índice de várias colunas mantém a ordem', () => {
  assert.match(
    sql(mysql, { tipo: 'criar-indice', nome: 'i', colunas: ['a', 'b'], unico: false }),
    /\(`a`, `b`\)/
  );
});

test('apagar índice: o MySQL precisa da tabela, os outros não', () => {
  // `DROP INDEX x ON t` no MySQL; `DROP INDEX x` no PostgreSQL e no SQLite.
  assert.match(
    sql(mysql, { tipo: 'apagar-indice', nome: 'i' }),
    /DROP INDEX `i` ON `escola`\.`alunos`/
  );
  assert.match(sql(pg, { tipo: 'apagar-indice', nome: 'i' }), /DROP INDEX "i"/);
  assert.equal(sql(pg, { tipo: 'apagar-indice', nome: 'i' }).includes('ON '), false);
});

// ---------------------------------------------------------------------------
// Chave estrangeira e comentário
// ---------------------------------------------------------------------------

test('apagar chave estrangeira usa o verbo do dialeto', () => {
  assert.match(
    sql(mysql, { tipo: 'apagar-chave-estrangeira', nome: 'fk1' }),
    /DROP FOREIGN KEY `fk1`/
  );
  assert.match(
    sql(pg, { tipo: 'apagar-chave-estrangeira', nome: 'fk1' }),
    /DROP CONSTRAINT "fk1"/
  );
});

test('comentário da tabela: MySQL no ALTER, PostgreSQL no COMMENT ON', () => {
  assert.match(sql(mysql, { tipo: 'comentario-tabela', texto: 'oi' }), /COMMENT = 'oi'/);
  assert.match(sql(pg, { tipo: 'comentario-tabela', texto: 'oi' }), /COMMENT ON TABLE .* IS 'oi'/);
});

test('comentário com aspa é escapado', () => {
  assert.match(sql(mysql, { tipo: 'comentario-tabela', texto: "d'agua" }), /'d''agua'/);
});

// ---------------------------------------------------------------------------
// O que cada dialeto NÃO faz
// ---------------------------------------------------------------------------

test('o SQLite não altera coluna, e a operação nem é oferecida', () => {
  const ops = operacoesDisponiveis(DIALETOS.sqlite);
  assert.equal(ops.includes('alterar-coluna'), false);
  assert.equal(ops.includes('acrescentar-coluna'), true, 'mas acrescentar ele faz');
});

test('o SQLite não tem comentário de tabela nem DROP de chave estrangeira', () => {
  const ops = operacoesDisponiveis(DIALETOS.sqlite);
  assert.equal(ops.includes('comentario-tabela'), false);
  assert.equal(ops.includes('apagar-chave-estrangeira'), false);
});

test('pedir uma operação que o dialeto não faz é RECUSADO', () => {
  // Não basta esconder o botão: a rota também recusa.
  assert.throws(
    () =>
      sql(sqlite, {
        tipo: 'alterar-coluna',
        coluna: 'x',
        tipoSql: 'int',
        obrigatoria: false,
        padrao: null,
      }),
    /não faz/i
  );
});

test('MySQL e PostgreSQL fazem tudo o que a spec lista', () => {
  for (const dialeto of [DIALETOS.mysql, DIALETOS.postgres]) {
    const ops: readonly string[] = operacoesDisponiveis(dialeto);
    for (const esperada of [
      'renomear-tabela',
      'renomear-coluna',
      'acrescentar-coluna',
      'alterar-coluna',
      'apagar-coluna',
      'criar-indice',
      'apagar-indice',
      'apagar-chave-estrangeira',
      'comentario-tabela',
    ]) {
      assert.equal(ops.includes(esperada), true, `${dialeto.nome} devia fazer ${esperada}`);
    }
  }
});

// ---------------------------------------------------------------------------
// A fronteira
// ---------------------------------------------------------------------------

test('nome vazio é recusado', () => {
  assert.throws(() => sql(mysql, { tipo: 'renomear-tabela', novo: '' }), /inválid/i);
  assert.throws(() => sql(mysql, { tipo: 'renomear-tabela', novo: '   ' }), /inválid/i);
});

test('tipo de coluna vazio é recusado', () => {
  assert.throws(
    () =>
      sql(mysql, {
        tipo: 'acrescentar-coluna',
        coluna: 'x',
        tipoSql: '',
        obrigatoria: false,
        padrao: null,
      }),
    /tipo/i
  );
});

test('índice sem coluna nenhuma é recusado', () => {
  assert.throws(
    () => sql(mysql, { tipo: 'criar-indice', nome: 'i', colunas: [], unico: false }),
    /coluna/i
  );
});

test('operação desconhecida é recusada', () => {
  // Recusada pela lista do dialeto, ANTES de chegar ao `switch`: é a mesma
  // barreira que impede pedir ao SQLite algo que ele não faz.
  assert.throws(() => sql(mysql, { tipo: 'inventada' }), /não faz|desconhecid/i);
});
