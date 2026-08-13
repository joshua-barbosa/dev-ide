// Integração dos drivers de rede contra servidores reais.
//
// Ficam desligados por padrão: `npm test` precisa passar offline. Para ligar,
// aponte uma URL de conexão:
//
//   DEV_IDE_TEST_MYSQL="mysql://user:senha@host:3306/banco" npm test
//   DEV_IDE_TEST_POSTGRES="postgres://user:senha@host:5432/banco" npm test
//
// Todas as conexões abrem em modo somente-leitura, e um dos testes verifica
// justamente que o servidor recusa escrita — então é seguro apontar para um
// banco real.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mysqlDriver } from '../connections/drivers/mysql';
import { postgresDriver } from '../connections/drivers/postgres';
import type { Driver, ResolvedConfig, Session } from '../connections/types';

function configDe(url: string, type: string): ResolvedConfig {
  const parsed = new URL(url);
  return {
    id: `it-${type}`,
    type,
    label: parsed.host,
    readOnly: true, // sempre RO: o teste toca em banco de verdade
    fields: {
      host: parsed.hostname,
      port: Number(parsed.port),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      main_database: parsed.pathname.replace(/^\//, ''),
    },
  };
}

/** Percorre a árvore sempre pelo primeiro filho navegável, até onde der. */
async function descerAteFolha(session: Session, profundidadeMax: number): Promise<string[][]> {
  const visitados: string[][] = [];
  let caminho: string[] = [];

  for (let nivel = 0; nivel < profundidadeMax; nivel += 1) {
    const filhos = await session.children(caminho);
    if (filhos.length === 0) break;
    visitados.push(filhos.map((n) => n.label));
    const proximo = filhos.find((n) => n.hasChildren);
    if (proximo === undefined) break;
    caminho = [...caminho, proximo.id];
  }
  return visitados;
}

function suiteDe(driver: Driver, envVar: string, escrita: string, erroEsperado: RegExp): void {
  const url = process.env[envVar];

  test(`integração ${driver.type}`, { skip: url === undefined ? `defina ${envVar} para rodar` : false }, async (t) => {
    const session = await driver.connect(configDe(url as string, driver.type));
    t.after(() => session.close());

    await t.test('navega a árvore até as colunas', async () => {
      const niveis = await descerAteFolha(session, 8);
      assert.ok(niveis.length >= 4, `esperava ao menos 4 níveis, veio ${niveis.length}`);
      assert.ok(niveis[0].length > 0, 'a raiz precisa ter ao menos o nó do servidor');
      assert.ok(niveis[1].length > 0, 'o servidor precisa listar ao menos um banco');
    });

    await t.test('esconde schemas de sistema por padrão', async () => {
      const niveis = await descerAteFolha(session, 8);
      const todos = niveis.flat().map((n) => n.toLowerCase());
      assert.ok(!todos.includes('information_schema'), 'information_schema não deveria aparecer');
      assert.ok(!todos.includes('pg_catalog'), 'pg_catalog não deveria aparecer');
      assert.ok(!todos.includes('performance_schema'), 'performance_schema não deveria aparecer');
    });

    await t.test('executa SELECT e descreve as colunas', async () => {
      const r = await session.execute!({ statement: 'SELECT 1 AS um' });
      assert.deepEqual(r.columns.map((c) => c.name), ['um']);
      assert.equal(Number(r.rows[0][0]), 1);
      assert.equal(r.truncated, false);
    });

    await t.test('respeita o limite de linhas', async () => {
      const r = await session.execute!({
        statement: 'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3',
        rowLimit: 2,
      });
      assert.equal(r.rows.length, 2);
      assert.equal(r.truncated, true);
    });

    await t.test('o servidor recusa escrita na sessão somente-leitura', async () => {
      await assert.rejects(() => session.execute!({ statement: escrita }), erroEsperado);
    });
  });
}

suiteDe(
  mysqlDriver,
  'DEV_IDE_TEST_MYSQL',
  'CREATE TABLE dev_ide_teste_rw (a INT)',
  /read only|readonly/i
);

suiteDe(
  postgresDriver,
  'DEV_IDE_TEST_POSTGRES',
  'CREATE TABLE dev_ide_teste_rw (a INT)',
  /read-only|read only/i
);
