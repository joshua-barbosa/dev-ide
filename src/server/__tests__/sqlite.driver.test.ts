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

// ---- filtro por nome (spec 009) ----

test('o filtro reduz a lista pelo padrão de LIKE', async () => {
  const { session } = await abrir();
  const caminho = ['main', 'tables'];

  const tudo = await session.children(caminho);
  assert.deepEqual(tudo.map((n) => n.label).sort(), ['alunos', 'notas']);

  const filtradas = await session.children(caminho, { filtro: '%alun%' });
  assert.deepEqual(filtradas.map((n) => n.label), ['alunos']);

  await session.close();
});

test('filtro nulo lista tudo, como se não houvesse filtro', async () => {
  const { session } = await abrir();
  const caminho = ['main', 'tables'];

  assert.equal((await session.children(caminho, { filtro: null })).length, 2);
  assert.equal((await session.children(caminho, {})).length, 2);

  await session.close();
});

test('padrão hostil vira busca vazia, e NÃO vira sintaxe', async () => {
  // O teste que carrega a spec 009. Se o padrão fosse concatenado, isto
  // lançaria erro de sintaxe — ou pior, executaria. Zero linhas é a prova de
  // que o texto chegou LIGADO, como valor.
  const { session, file } = await abrir();
  const caminho = ['main', 'tables'];

  for (const hostil of ["'; DROP TABLE alunos; --", "%'--", "' OR '1'='1"]) {
    const achados = await session.children(caminho, { filtro: hostil });
    assert.deepEqual(achados, [], `padrão deveria não achar nada: ${hostil}`);
  }

  // E a tabela continua lá.
  assert.deepEqual(
    (await session.children(caminho)).map((n) => n.label).sort(),
    ['alunos', 'notas'],
    'uma tabela sumiu — o padrão foi executado'
  );

  await session.close();
  const db = new DatabaseSync(file);
  const restantes = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  db.close();
  assert.equal(restantes.length, 2, 'o banco foi alterado pelo padrão');
});

test('o filtro não vaza para a listagem seguinte', async () => {
  const { session } = await abrir();
  const caminho = ['main', 'tables'];

  await session.children(caminho, { filtro: '%alun%' });
  assert.equal((await session.children(caminho)).length, 2, 'o filtro ficou grudado');

  await session.close();
});

// ---------------------------------------------------------------------------
// Somente-leitura (AC-30 da spec 038)
// ---------------------------------------------------------------------------
//
// A trava já existia nos três drivers — SQLite pela flag do motor, MySQL com
// `SET SESSION TRANSACTION READ ONLY`, PostgreSQL com
// `SET default_transaction_read_only = on`. O que NÃO existia era teste, e por
// isso desfazê-la não quebrava nada.
//
// Importa mais a partir daqui: as fases F5 (editar pela grade) e F6 (Edit Table)
// vão escrever no banco, e esta é a única coisa entre elas e o banco do usuário.
//
// O SQLite é quem prova isto na suíte porque roda sem servidor externo. O
// mecanismo é diferente em cada driver, mas o contrato é o mesmo: quem recusa é
// o BANCO, não um filtro de texto no SQL nosso — que qualquer comentário
// enganaria.

test('conexão somente-leitura recusa INSERT', async () => {
  const { session } = await abrir(true);
  try {
    await assert.rejects(
      () => session.execute!({ statement: "INSERT INTO alunos(nome) VALUES ('novo')" }),
      /readonly|read-only|somente/i
    );
  } finally {
    await session.close();
  }
});

test('conexão somente-leitura recusa UPDATE, DELETE e DDL', async () => {
  const { session } = await abrir(true);
  try {
    for (const sql of [
      "UPDATE alunos SET nome = 'x'",
      'DELETE FROM alunos',
      'DROP TABLE alunos',
      'CREATE TABLE nova (id INTEGER)',
      'ALTER TABLE alunos ADD COLUMN extra TEXT',
    ]) {
      await assert.rejects(() => session.execute!({ statement: sql }), `aceitou: ${sql}`);
    }
  } finally {
    await session.close();
  }
});

test('conexão somente-leitura continua LENDO', async () => {
  // A trava não pode virar uma conexão inútil.
  const { session } = await abrir(true);
  try {
    const r = await session.execute!({ statement: 'SELECT nome FROM alunos ORDER BY nome' });
    assert.equal(r.rowCount, 2);
  } finally {
    await session.close();
  }
});

test('o banco em disco não muda depois de uma escrita recusada', async () => {
  // Recusar com o dado já gravado seria pior que não recusar.
  const { session, file } = await abrir(true);
  const antes = fs.readFileSync(file);
  try {
    await session.execute!({ statement: "INSERT INTO alunos(nome) VALUES ('novo')" }).catch(() => {});
  } finally {
    await session.close();
  }
  assert.deepEqual(fs.readFileSync(file), antes);
});

test('a mesma conexão SEM somente-leitura escreve', async () => {
  // Prova que o teste acima mede a trava, e não uma falha geral de escrita.
  const { session } = await abrir(false);
  try {
    await session.execute!({ statement: "INSERT INTO alunos(nome) VALUES ('novo')" });
    const r = await session.execute!({ statement: 'SELECT COUNT(*) AS n FROM alunos' });
    assert.equal(r.rows[0]?.[0], 3);
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------------------
// Modelos de SQL do menu (spec 040)
// ---------------------------------------------------------------------------
//
// `modelos.test.ts` prova a montagem sem banco. Aqui se prova o que só um banco
// responde: que as colunas lidas do catálogo chegam certas ao modelo, e que o
// SQL gerado **roda de verdade**. Um modelo que não compila no motor é pior que
// nenhum modelo.

async function acao(session: Session, objeto: string, actionId: string): Promise<string> {
  const r = await session.runAction!({ nodePath: ['main', 'tables', objeto], actionId });
  return r.content;
}

test('o menu de uma tabela oferece os modelos; o de uma view, menos', async () => {
  const { session } = await abrir();
  try {
    const tabelas = await session.children(['main', 'tables']);
    const ids = (tabelas.find((n) => n.id === 'alunos')?.actions ?? []).map((a) => a.id);
    assert.deepEqual(ids.includes('template-insert'), true);
    assert.deepEqual(ids.includes('drop'), true);
    // AC-7: numa view não há o que inserir nem o que esvaziar.
    const views = await session.children(['main', 'views']);
    const idsView = (views.find((n) => n.id === 'alunos_view')?.actions ?? []).map((a) => a.id);
    assert.deepEqual(idsView.includes('template-insert'), false);
    assert.deepEqual(idsView.includes('drop-view'), true);
  } finally {
    await session.close();
  }
});

test('o SQLite não oferece TRUNCATE, porque não tem', async () => {
  const { session } = await abrir();
  try {
    const tabelas = await session.children(['main', 'tables']);
    const ids = (tabelas.find((n) => n.id === 'alunos')?.actions ?? []).map((a) => a.id);
    assert.deepEqual(ids.includes('truncate'), false);
    assert.deepEqual(ids.includes('esvaziar'), true);
  } finally {
    await session.close();
  }
});

test('o INSERT gerado pula a chave e RODA no banco', async () => {
  const { session } = await abrir();
  try {
    const sql = await acao(session, 'alunos', 'template-insert');
    assert.equal(sql.includes('"id"'), false, 'a chave INTEGER PRIMARY KEY é o rowid');
    assert.match(sql, /"nome", "foto"/);

    // Trocar os marcadores por valores e rodar: é a prova de que o modelo
    // compila no motor, e não só de que a string tem a cara certa.
    const pronto = sql.replace(':nome', "'novo'").replace(':foto', 'NULL');
    await session.execute!({ statement: pronto.split('\n').filter((l) => !l.startsWith('--')).join('\n') });
    const r = await session.execute!({ statement: "SELECT nome FROM alunos WHERE nome = 'novo'" });
    assert.equal(r.rowCount, 1);
  } finally {
    await session.close();
  }
});

test('o UPDATE e o DELETE gerados trazem o WHERE da chave e RODAM', async () => {
  const { session } = await abrir();
  try {
    const update = await acao(session, 'alunos', 'template-update');
    assert.match(update, /WHERE "id" = /);
    const pronto = update.replace(':nome', "'trocado'").replace(':foto', 'NULL').replace(':id', '1');
    await session.execute!({ statement: pronto.split('\n').filter((l) => !l.startsWith('--')).join('\n') });
    const r = await session.execute!({ statement: 'SELECT nome FROM alunos WHERE id = 1' });
    assert.equal(r.rows[0]?.[0], 'trocado');

    const del = await acao(session, 'alunos', 'template-delete');
    assert.match(del, /WHERE "id" = /);
  } finally {
    await session.close();
  }
});

test('o SELECT gerado lista as colunas e RODA', async () => {
  const { session } = await abrir();
  try {
    const sql = await acao(session, 'alunos', 'template-select');
    const r = await session.execute!({ statement: sql });
    assert.deepEqual(r.columns.map((c) => c.name), ['id', 'nome', 'foto']);
  } finally {
    await session.close();
  }
});

test('os destrutivos vêm com aviso e NÃO são executados por serem gerados', async () => {
  const { session } = await abrir();
  try {
    const drop = await acao(session, 'alunos', 'drop');
    assert.match(drop, /^--/);
    assert.match(drop, /DROP TABLE "alunos"/);

    // O ponto da spec: pedir a ação NÃO apaga nada. A tabela continua lá.
    const r = await session.execute!({ statement: 'SELECT COUNT(*) FROM alunos' });
    assert.equal(Number(r.rows[0]?.[0]) > 0, true, 'gerar o DROP não apagou a tabela');
  } finally {
    await session.close();
  }
});

test('copiar tabela gera criação e carga que RODAM', async () => {
  const { session } = await abrir();
  try {
    const sql = await acao(session, 'alunos', 'copiar');
    for (const comando of sql.split(';').map((c) =>
      c.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim()
    )) {
      if (comando !== '') await session.execute!({ statement: comando });
    }
    const r = await session.execute!({ statement: 'SELECT COUNT(*) FROM alunos_copia' });
    assert.equal(Number(r.rows[0]?.[0]), 2, 'a cópia levou os dados junto');
  } finally {
    await session.close();
  }
});
