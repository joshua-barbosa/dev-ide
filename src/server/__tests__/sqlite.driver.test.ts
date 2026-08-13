import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from '../connections/drivers/sqlite';
import type { ResolvedConfig, Session } from '../connections/types';

/** Cria um banco de arquivo com um esquema pequeno mas representativo. */
function bancoDeTeste(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-sqlite-')), 'teste.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE alunos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, foto BLOB);
    CREATE TABLE notas (id INTEGER PRIMARY KEY, aluno_id INTEGER, valor REAL);
    CREATE VIEW alunos_view AS SELECT nome FROM alunos;
    CREATE INDEX idx_notas_aluno ON notas(aluno_id);
  `);
  const insert = db.prepare('INSERT INTO alunos(nome, foto) VALUES (?, ?)');
  insert.run('joshua', Buffer.from([0xde, 0xad]));
  insert.run('maria', null);
  db.close();
  return file;
}

function config(file: string, readOnly = false): ResolvedConfig {
  return { id: 'c1', type: 'sqlite', label: 'teste', readOnly, fields: { file } };
}

async function abrir(readOnly = false): Promise<{ session: Session; file: string }> {
  const file = bancoDeTeste();
  return { session: await sqliteDriver.connect(config(file, readOnly)), file };
}

// ---- metadados do driver ----

test('driver se descreve para a UI', () => {
  assert.equal(sqliteDriver.type, 'sqlite');
  assert.equal(sqliteDriver.kind, 'sql');
  const arquivo = sqliteDriver.fields.find((f) => f.name === 'file');
  assert.equal(arquivo?.required, true);
  assert.equal(sqliteDriver.fields.some((f) => f.secret === true), false, 'SQLite não tem segredo');
});

// ---- navegação da árvore ----

test('raiz mostra o banco', async () => {
  const { session, file } = await abrir();
  const raiz = await session.children([]);
  assert.equal(raiz.length, 1);
  assert.equal(raiz[0].id, 'main');
  assert.equal(raiz[0].label, path.basename(file));
  assert.equal(raiz[0].icon, 'database');
  assert.equal(raiz[0].hasChildren, true);
  await session.close();
});

test('banco mostra as categorias com contagem', async () => {
  const { session } = await abrir();
  const categorias = await session.children(['main']);
  assert.deepEqual(categorias.map((n) => n.id), ['tables', 'views', 'indexes']);
  assert.equal(categorias[0].detail, '2');
  assert.equal(categorias[1].detail, '1');
  assert.equal(categorias[2].detail, '1');
  await session.close();
});

test('lista tabelas com contagem de linhas e esconde as internas do sqlite', async () => {
  const { session } = await abrir();
  const tabelas = await session.children(['main', 'tables']);
  assert.deepEqual(tabelas.map((n) => n.label), ['alunos', 'notas']);
  assert.equal(tabelas[0].detail, '2', 'alunos tem 2 linhas');
  assert.equal(tabelas[0].icon, 'table');
  assert.ok(!tabelas.some((n) => n.label.startsWith('sqlite_')));
  await session.close();
});

test('lista colunas com tipo e marca a chave primária', async () => {
  const { session } = await abrir();
  const colunas = await session.children(['main', 'tables', 'alunos']);
  assert.deepEqual(colunas.map((n) => n.label), ['id', 'nome', 'foto']);
  assert.equal(colunas[0].icon, 'column');
  assert.match(colunas[0].detail ?? '', /INTEGER/);
  assert.match(colunas[0].detail ?? '', /PK/);
  assert.match(colunas[1].detail ?? '', /NOT NULL/);
  await session.close();
});

test('view também abre em colunas', async () => {
  const { session } = await abrir();
  const colunas = await session.children(['main', 'views', 'alunos_view']);
  assert.deepEqual(colunas.map((n) => n.label), ['nome']);
  await session.close();
});

test('caminho desconhecido devolve vazio em vez de estourar', async () => {
  const { session } = await abrir();
  assert.deepEqual(await session.children(['main', 'inexistente']), []);
  await session.close();
});

// ---- execução ----

test('executa SELECT devolvendo colunas tipadas', async () => {
  const { session } = await abrir();
  const r = await session.execute!({ statement: 'SELECT id, nome FROM alunos ORDER BY id' });
  assert.deepEqual(r.columns.map((c) => c.name), ['id', 'nome']);
  assert.equal(r.columns[0].type, 'INTEGER');
  assert.deepEqual(r.rows, [[1, 'joshua'], [2, 'maria']]);
  assert.equal(r.rowCount, 2);
  assert.equal(r.truncated, false);
  await session.close();
});

test('respeita o limite de linhas e sinaliza truncamento', async () => {
  const { session } = await abrir();
  const r = await session.execute!({ statement: 'SELECT * FROM alunos', rowLimit: 1 });
  assert.equal(r.rows.length, 1);
  assert.equal(r.truncated, true);
  await session.close();
});

test('normaliza BLOB para hexadecimal', async () => {
  const { session } = await abrir();
  const r = await session.execute!({ statement: 'SELECT foto FROM alunos WHERE id = 1' });
  assert.equal(r.rows[0][0], '0xdead');
  await session.close();
});

test('SELECT sem linhas ainda descreve as colunas', async () => {
  const { session } = await abrir();
  const r = await session.execute!({ statement: 'SELECT id FROM alunos WHERE 1 = 0' });
  assert.deepEqual(r.columns.map((c) => c.name), ['id']);
  assert.deepEqual(r.rows, []);
  await session.close();
});

test('INSERT devolve mensagem de linhas afetadas', async () => {
  const { session } = await abrir();
  const r = await session.execute!({ statement: "INSERT INTO alunos(nome) VALUES ('novo')" });
  assert.deepEqual(r.rows, []);
  assert.equal(r.rowCount, 1);
  assert.match(r.message ?? '', /1 linha/);
  await session.close();
});

test('erro de SQL vira mensagem legível', async () => {
  const { session } = await abrir();
  await assert.rejects(() => session.execute!({ statement: 'SELECT * FROM nao_existe' }), /nao_existe/);
  await session.close();
});

// ---- somente-leitura ----

test('conexão somente-leitura é bloqueada pelo próprio SQLite', async () => {
  const { session } = await abrir(true);
  const leitura = await session.execute!({ statement: 'SELECT count(*) AS n FROM alunos' });
  assert.equal(leitura.rows[0][0], 2, 'leitura deve funcionar');

  await assert.rejects(
    () => session.execute!({ statement: "INSERT INTO alunos(nome) VALUES ('x')" }),
    /readonly|somente leitura/i
  );
  await session.close();
});

test('arquivo inexistente dá erro claro', async () => {
  await assert.rejects(
    () => sqliteDriver.connect(config('/tmp/nao/existe/banco.db')),
    /não encontrado|cannot open|unable to open/i
  );
});
