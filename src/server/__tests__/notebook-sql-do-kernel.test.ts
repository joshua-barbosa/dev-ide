// O sql() de dentro do kernel, visto pelo motor (spec 114, C), com sessões
// de mentira que anotam o que receberam.
//
// Decisões do usuário (30/09): cada sql() vale sozinho; erro vira exceção
// normal; sem confirmação; tudo-ou-nada só com sql.transacao explícito.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqlDoKernel } from '../notebook/sql-do-kernel';
import type { Session } from '../connections/types';
import type { ExecuteRequest, QueryResult } from '../../shared/contracts';

function sessaoFalsa(nome: string, log: string[], resposta?: (r: ExecuteRequest) => QueryResult): Session {
  return {
    kind: 'database',
    children: async () => [],
    execute: async (r: ExecuteRequest) => {
      log.push(`${nome}: ${r.statement} ${JSON.stringify(r.params ?? [])} @${r.database ?? ''}`);
      if (/falha/.test(r.statement)) throw new Error('erro do banco');
      return resposta?.(r) ?? { columns: [], rows: [], rowCount: 1, durationMs: 0, truncated: false, message: '1 linha(s) afetada(s).' };
    },
    close: async () => { log.push(`${nome}: fechou`); },
  } as unknown as Session;
}

function montar(tipo = 'postgres', vinculo: { connectionId: string; database: string } | null = { connectionId: 'c1', database: 'loja' }) {
  const log: string[] = [];
  let dedicadas = 0;
  const sql = new SqlDoKernel({
    vinculo: () => vinculo,
    sessao: async () => sessaoFalsa('pool', log, (r) => (/^SELECT/i.test(r.statement)
      ? { columns: [{ name: 'id', type: 'int' }, { name: 'nome', type: 'text' }], rows: [[1, 'Ana']], rowCount: 1, durationMs: 0, truncated: false }
      : { columns: [], rows: [], rowCount: 3, durationMs: 0, truncated: false, message: '3 linha(s) afetada(s).' })),
    abrirDedicada: async () => sessaoFalsa(`dedicada${++dedicadas}`, log),
    tipo: () => tipo,
  });
  return { sql, log };
}

test('SELECT: ? vira o marcador do banco, e as linhas voltam com as colunas', async () => {
  const { sql, log } = montar('postgres');
  const r = await sql.atender({ tipo: 'sql', texto: 'SELECT id, nome FROM clientes WHERE ativo = ?', params: [1] });
  assert.deepEqual(r, { colunas: ['id', 'nome'], linhas: [[1, 'Ana']], linhasAfetadas: null });
  assert.equal(log[0], 'pool: SELECT id, nome FROM clientes WHERE ativo = $1 [1] @loja');
});

test('escrita: linhas afetadas quando o banco conta', async () => {
  const { sql } = montar('mysql');
  const r = await sql.atender({ tipo: 'sql', texto: 'UPDATE t SET a = ? WHERE id = ?', params: ['x', 2] });
  assert.equal(r.linhasAfetadas, 3);
});

test('escrita no Postgres (cursor): o banco não conta → null, e não um 0 enganoso', async () => {
  const log: string[] = [];
  const sql = new SqlDoKernel({
    vinculo: () => ({ connectionId: 'c1', database: 'loja' }),
    sessao: async () => sessaoFalsa('pool', log, () => ({ columns: [], rows: [], rowCount: 0, durationMs: 0, truncated: false, message: 'Comando executado.' })),
    abrirDedicada: async () => sessaoFalsa('d', log),
    tipo: () => 'postgres',
  });
  assert.equal((await sql.atender({ tipo: 'sql', texto: 'UPDATE t SET a = 1', params: [] })).linhasAfetadas, null);
});

test('sem conexão no notebook: erro que diz o que fazer', async () => {
  const { sql } = montar('postgres', null);
  await assert.rejects(sql.atender({ tipo: 'sql', texto: 'SELECT 1', params: [] }), /conexão do notebook/);
});

test('valor que não é simples (objeto, lista) vai como JSON — nunca colado no texto', async () => {
  const { sql, log } = montar('postgres');
  await sql.atender({ tipo: 'sql', texto: 'SELECT * FROM t WHERE x = ? AND y = ?', params: [{ a: 1 }, [1, 2]] });
  assert.match(log[0], /\["\{\\"a\\":1\}","\[1,2\]"\]/);
});

test('transação: BEGIN, os comandos e o COMMIT numa sessão PRÓPRIA, fechada no fim', async () => {
  const { sql, log } = montar('postgres');
  const { transacao } = await sql.atender({ tipo: 'sql-transacao', acao: 'comecar' }) as { transacao: number };
  await sql.atender({ tipo: 'sql', texto: 'UPDATE a SET x = ?', params: [1], transacao });
  await sql.atender({ tipo: 'sql', texto: 'SELECT 1', params: [] }); // fora do bloco: o pool
  await sql.atender({ tipo: 'sql-transacao', acao: 'confirmar', transacao });
  assert.deepEqual(log, [
    'dedicada1: BEGIN [] @loja',
    'dedicada1: UPDATE a SET x = $1 [1] @loja',
    'pool: SELECT 1 [] @loja',
    'dedicada1: COMMIT [] @loja',
    'dedicada1: fechou',
  ]);
});

test('transação desfeita: ROLLBACK e fecha', async () => {
  const { sql, log } = montar('mysql');
  const { transacao } = await sql.atender({ tipo: 'sql-transacao', acao: 'comecar' }) as { transacao: number };
  await sql.atender({ tipo: 'sql-transacao', acao: 'desfazer', transacao });
  assert.deepEqual(log, ['dedicada1: START TRANSACTION [] @loja', 'dedicada1: ROLLBACK [] @loja', 'dedicada1: fechou']);
});

test('SQL Server fala BEGIN/COMMIT TRANSACTION', async () => {
  const { sql, log } = montar('sqlserver');
  const { transacao } = await sql.atender({ tipo: 'sql-transacao', acao: 'comecar' }) as { transacao: number };
  await sql.atender({ tipo: 'sql-transacao', acao: 'confirmar', transacao });
  assert.deepEqual(log.slice(0, 2), ['dedicada1: BEGIN TRANSACTION [] @loja', 'dedicada1: COMMIT TRANSACTION [] @loja']);
});

test('célula que terminou (ou foi parada) com transação aberta: ROLLBACK', async () => {
  const { sql, log } = montar('postgres');
  await sql.atender({ tipo: 'sql-transacao', acao: 'comecar' });
  await sql.desfazerAbertas();
  assert.deepEqual(log.slice(-2), ['dedicada1: ROLLBACK [] @loja', 'dedicada1: fechou']);
});

test('erro do banco vira erro do pedido (a exceção da célula)', async () => {
  const { sql } = montar('postgres');
  await assert.rejects(sql.atender({ tipo: 'sql', texto: 'SELECT falha', params: [] }), /erro do banco/);
});
