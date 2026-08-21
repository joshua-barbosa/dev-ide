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

// ---------------------------------------------------------------------------
// A aba de tabela (spec 041)
// ---------------------------------------------------------------------------
//
// A montagem do SQL é testada sem banco em `tabela.test.ts`. Aqui se prova o
// que só um motor responde: que a página, o total e a ordenação batem com os
// dados de verdade.

async function pagina(session: Session, extra: Record<string, unknown> = {}) {
  return session.readTable!({
    nodePath: ['main', 'tables', 'alunos'],
    pagina: 1,
    porPagina: 1,
    ...extra,
  });
}

test('a página traz o tamanho pedido, e o total é o da TABELA', async () => {
  const { session } = await abrir();
  try {
    const p = await pagina(session);
    assert.equal(p.resultado.rows.length, 1, 'trouxe uma linha');
    assert.equal(p.total, 2, 'e diz que existem duas');
    assert.match(p.sql, /LIMIT 1/);
  } finally {
    await session.close();
  }
});

test('a segunda página traz a OUTRA linha', async () => {
  const { session } = await abrir();
  try {
    const primeira = await pagina(session, { ordenar: { coluna: 'nome', desc: false } });
    const segunda = await pagina(session, {
      pagina: 2,
      ordenar: { coluna: 'nome', desc: false },
    });
    assert.notDeepEqual(primeira.resultado.rows[0], segunda.resultado.rows[0]);
    assert.match(segunda.sql, /OFFSET 1/);
  } finally {
    await session.close();
  }
});

test('ordenar decrescente inverte de verdade', async () => {
  const { session } = await abrir();
  try {
    const asc = await pagina(session, { porPagina: 10, ordenar: { coluna: 'nome', desc: false } });
    const desc = await pagina(session, { porPagina: 10, ordenar: { coluna: 'nome', desc: true } });
    assert.deepEqual(asc.resultado.rows.map((l) => l[1]).reverse(), desc.resultado.rows.map((l) => l[1]));
  } finally {
    await session.close();
  }
});

test('o filtro reduz as linhas E o total, juntos', async () => {
  // É o par que faz a paginação não mentir: filtrar e continuar dizendo "2"
  // mandaria o usuário para uma página que não existe.
  const { session } = await abrir();
  try {
    const p = await pagina(session, { porPagina: 10, filtros: [{ coluna: 'nome', valor: 'josh' }] });
    assert.equal(p.resultado.rows.length, 1);
    assert.equal(p.total, 1);
  } finally {
    await session.close();
  }
});

test('o cabeçalho diz qual coluna é chave e qual é obrigatória', async () => {
  const { session } = await abrir();
  try {
    const p = await pagina(session);
    const porNome = new Map(p.columns.map((c) => [c.name, c]));
    assert.equal(porNome.get('id')?.chave, true);
    assert.equal(porNome.get('nome')?.obrigatoria, true);
    assert.equal(porNome.get('foto')?.obrigatoria, false);
  } finally {
    await session.close();
  }
});

test('coluna inventada na ordenação é recusada, e nada roda', async () => {
  const { session } = await abrir();
  try {
    await assert.rejects(
      () => pagina(session, { ordenar: { coluna: 'nao_existe', desc: false } }),
      /coluna desconhecida/i
    );
  } finally {
    await session.close();
  }
});

test('valor de filtro com aspa não quebra a consulta', async () => {
  const { session } = await abrir();
  try {
    const p = await pagina(session, { porPagina: 10, filtros: [{ coluna: 'nome', valor: "'; --" }] });
    assert.equal(p.resultado.rows.length, 0, 'não casa com ninguém, e não é erro');
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------------------
// Escrever pela grade (spec 044)
// ---------------------------------------------------------------------------
//
// A montagem do SQL é testada sem banco em `escrita.test.ts`. Aqui se prova o
// que só um motor responde: que a transação desfaz, que a alteração concorrente
// é detectada, e que somente-leitura recusa.

const NODE = ['main', 'tables', 'alunos'];

test('a prévia monta o SQL e NÃO toca no banco', async () => {
  const { session } = await abrir();
  try {
    const r = await session.writeTable!({
      nodePath: NODE,
      alteracoes: [{ chave: { id: 1 }, antes: { nome: 'joshua' }, depois: { nome: 'x' } }],
      simular: true,
    });
    assert.equal(r.executado, false);
    assert.match(r.comandos[0]?.sql ?? '', /UPDATE/);

    const depois = await session.execute!({ statement: 'SELECT nome FROM alunos WHERE id = 1' });
    assert.equal(depois.rows[0]?.[0], 'joshua', 'a simulação não gravou nada');
  } finally {
    await session.close();
  }
});

test('gravar altera de verdade, e o SQL é o MESMO da prévia', async () => {
  const { session } = await abrir();
  try {
    const pedido = {
      nodePath: NODE,
      alteracoes: [{ chave: { id: 1 }, antes: { nome: 'joshua' }, depois: { nome: 'josh' } }],
    };
    const previa = await session.writeTable!({ ...pedido, simular: true });
    const feito = await session.writeTable!(pedido);

    assert.deepEqual(feito.comandos, previa.comandos, 'o que se leu é o que rodou');
    assert.equal(feito.executado, true);
    assert.equal(feito.linhasAfetadas, 1);

    const r = await session.execute!({ statement: 'SELECT nome FROM alunos WHERE id = 1' });
    assert.equal(r.rows[0]?.[0], 'josh');
  } finally {
    await session.close();
  }
});

test('linha alterada por baixo é DETECTADA, e nada é gravado', async () => {
  // É a razão de o valor antigo entrar no `WHERE`.
  const { session } = await abrir();
  try {
    // Alguém mexeu na linha depois que a página foi lida.
    await session.execute!({ statement: "UPDATE alunos SET nome = 'outro' WHERE id = 1" });

    await assert.rejects(
      () => session.writeTable!({
        nodePath: NODE,
        alteracoes: [{ chave: { id: 1 }, antes: { nome: 'joshua' }, depois: { nome: 'josh' } }],
      }),
      /mudou no banco/i
    );

    const r = await session.execute!({ statement: 'SELECT nome FROM alunos WHERE id = 1' });
    assert.equal(r.rows[0]?.[0], 'outro', 'a alteração de terceiros sobreviveu');
  } finally {
    await session.close();
  }
});

test('uma linha ruim desfaz a gravação INTEIRA', async () => {
  // Gravar metade seria pior que não gravar.
  const { session } = await abrir();
  try {
    await assert.rejects(() => session.writeTable!({
      nodePath: NODE,
      alteracoes: [
        { chave: { id: 1 }, antes: { nome: 'joshua' }, depois: { nome: 'novo-1' } },
        // Esta não casa: o valor antigo está errado de propósito.
        { chave: { id: 2 }, antes: { nome: 'ERRADO' }, depois: { nome: 'novo-2' } },
      ],
    }));

    const r = await session.execute!({ statement: 'SELECT nome FROM alunos ORDER BY id' });
    assert.deepEqual(r.rows.map((l) => l[0]), ['joshua', 'maria'], 'nenhuma das duas entrou');
  } finally {
    await session.close();
  }
});

test('inserir e apagar pela grade funcionam', async () => {
  const { session } = await abrir();
  try {
    await session.writeTable!({ nodePath: NODE, insercoes: [{ nome: 'novato' }] });
    let r = await session.execute!({ statement: "SELECT id FROM alunos WHERE nome = 'novato'" });
    assert.equal(r.rowCount, 1);

    const id = r.rows[0]?.[0];
    await session.writeTable!({ nodePath: NODE, remocoes: [{ chave: { id: id as number } }] });
    r = await session.execute!({ statement: "SELECT id FROM alunos WHERE nome = 'novato'" });
    assert.equal(r.rowCount, 0);
  } finally {
    await session.close();
  }
});

test('apagar linha que já sumiu é DETECTADO, não ignorado', async () => {
  const { session } = await abrir();
  try {
    await assert.rejects(
      () => session.writeTable!({ nodePath: NODE, remocoes: [{ chave: { id: 9999 } }] }),
      /mudou no banco/i
    );
  } finally {
    await session.close();
  }
});

test('conexão somente-leitura recusa a escrita pela grade', async () => {
  // A trava é do motor, não da tela: mesmo que a interface deixasse clicar.
  const { session } = await abrir(true);
  try {
    await assert.rejects(() => session.writeTable!({
      nodePath: NODE,
      alteracoes: [{ chave: { id: 1 }, antes: { nome: 'joshua' }, depois: { nome: 'x' } }],
    }));
    const r = await session.execute!({ statement: 'SELECT nome FROM alunos WHERE id = 1' });
    assert.equal(r.rows[0]?.[0], 'joshua');
  } finally {
    await session.close();
  }
});

test('gravar NULL grava NULL, e texto vazio grava texto vazio', async () => {
  // Na linha 2, cuja `foto` nasce NULL — a da linha 1 é um BLOB.
  const { session } = await abrir();
  try {
    await session.writeTable!({
      nodePath: NODE,
      alteracoes: [{ chave: { id: 2 }, antes: { foto: null }, depois: { foto: '' } }],
    });
    let r = await session.execute!({ statement: 'SELECT foto IS NULL FROM alunos WHERE id = 2' });
    assert.equal(r.rows[0]?.[0], 0, 'virou string vazia, não NULL');

    await session.writeTable!({
      nodePath: NODE,
      alteracoes: [{ chave: { id: 2 }, antes: { foto: '' }, depois: { foto: null } }],
    });
    r = await session.execute!({ statement: 'SELECT foto IS NULL FROM alunos WHERE id = 2' });
    assert.equal(r.rows[0]?.[0], 1, 'e agora é NULL de verdade');
  } finally {
    await session.close();
  }
});

