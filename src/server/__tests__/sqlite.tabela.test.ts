// O driver SQLite visto pela ABA DE TABELA: ler página, escrever pela grade,
// ler a estrutura e gerar o `ALTER` (specs 041, 044, 045 e 046).
//
// Saiu de `sqlite.driver.test.ts` quando ele passou das 800 linhas do Artigo IV.
// O corte é por assunto: o outro arquivo prova o driver como a ÁRVORE o usa —
// navegar, executar, ver DDL —, e este prova o que a aba de tabela pede.
//
// O SQLite é quem carrega estes testes porque roda sem servidor externo. O
// mecanismo difere em cada driver; o contrato é o mesmo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from '../connections/drivers/sqlite';
import type { ResolvedConfig, Session } from '../connections/types';

/** O mesmo banco de teste do arquivo vizinho: esquema pequeno e representativo. */
function bancoDeTeste(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-sqlite-tab-')), 'teste.db');
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


// ---------------------------------------------------------------------------
// A estrutura da tabela (spec 045)
// ---------------------------------------------------------------------------

test('a estrutura traz colunas, DDL e índices num pedido só', async () => {
  const { session } = await abrir();
  try {
    const e = await session.tableStructure!(['main', 'tables', 'alunos']);
    assert.equal(e.nome, 'alunos');
    assert.equal(e.ehView, false);
    assert.match(e.ddl, /CREATE TABLE/);

    const porNome = new Map(e.colunas.map((c) => [c.name, c]));
    assert.equal(porNome.get('id')?.chave, true);
    assert.equal(porNome.get('id')?.autoIncremento, true, 'INTEGER PRIMARY KEY é o rowid');
    assert.equal(porNome.get('nome')?.obrigatoria, true);
    assert.equal(porNome.get('foto')?.obrigatoria, false);

    assert.equal('itens' in e.indices, true);
  } finally {
    await session.close();
  }
});

test('a view é reconhecida como view', async () => {
  const { session } = await abrir();
  try {
    const e = await session.tableStructure!(['main', 'views', 'alunos_view']);
    assert.equal(e.ehView, true);
    assert.match(e.ddl, /CREATE VIEW/i);
  } finally {
    await session.close();
  }
});

test('o que o SQLite não sabe responder vem como "não sei", não como lista vazia', async () => {
  // Confundir "este banco não tem o conceito" com "não há nenhum" é o mesmo
  // erro do total estimado da spec 041.
  const { session } = await abrir();
  try {
    const e = await session.tableStructure!(['main', 'tables', 'alunos']);
    assert.equal('naoSei' in e.gatilhos, true);
    assert.equal('naoSei' in e.checagens, true);
    // Índice e chave estrangeira ELE sabe: aí é lista, mesmo que vazia.
    assert.equal('itens' in e.indices, true);
    assert.equal('itens' in e.chavesEstrangeiras, true);
  } finally {
    await session.close();
  }
});

test('índice único e chave estrangeira aparecem quando existem', async () => {
  const { session, file } = await abrir();
  try {
    await session.execute!({ statement: 'CREATE UNIQUE INDEX idx_nome ON alunos(nome)' });
    await session.execute!({
      statement: 'CREATE TABLE notas2 (id INTEGER PRIMARY KEY, aluno_id INTEGER REFERENCES alunos(id))',
    });

    const e = await session.tableStructure!(['main', 'tables', 'alunos']);
    const indices = 'itens' in e.indices ? e.indices.itens : [];
    const unico = indices.find((i) => i.nome === 'idx_nome');
    assert.equal(unico?.unico, true);
    assert.deepEqual(unico?.colunas, ['nome']);
    // E a coluna passa a ser marcada como única.
    assert.equal(e.colunas.find((c) => c.name === 'nome')?.unica, true);

    const outra = await session.tableStructure!(['main', 'tables', 'notas2']);
    const fks = 'itens' in outra.chavesEstrangeiras ? outra.chavesEstrangeiras.itens : [];
    assert.equal(fks[0]?.tabelaReferenciada, 'alunos');
    assert.equal(fks[0]?.coluna, 'aluno_id');
    assert.equal(typeof file, 'string');
  } finally {
    await session.close();
  }
});

test('objeto que não existe dá erro claro, não estrutura vazia', async () => {
  const { session } = await abrir();
  try {
    await assert.rejects(
      () => session.tableStructure!(['main', 'tables', 'nao_existe']),
      /não encontrado/i
    );
  } finally {
    await session.close();
  }
});

// ---------------------------------------------------------------------------
// Alterar a estrutura (spec 046)
// ---------------------------------------------------------------------------
//
// A montagem é testada sem banco em `alterar.test.ts`. Aqui se prova o que só um
// motor responde: que o comando gerado COMPILA e faz o que diz. Um `ALTER` que
// não roda é pior que nenhum.

const ALVO = ['main', 'tables', 'alunos'];

/**
 * O comando sem as linhas de aviso.
 *
 * O SQL gerado traz um cabeçalho em comentário dizendo que ainda não rodou; o
 * motor ignoraria os comentários, mas tirá-los deixa a intenção do teste clara.
 */
const semComentarios = (sql: string): string =>
  sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();

test('o comando gerado NÃO é executado ao ser pedido', async () => {
  // É a decisão central da spec: a IDE gera, o usuário roda.
  const { session } = await abrir();
  try {
    const r = await session.alterStructure!({
      nodePath: ALVO,
      operacao: { tipo: 'apagar-coluna', coluna: 'foto' },
    });
    assert.match(r.sql, /DROP COLUMN "foto"/);

    // A coluna continua lá.
    const cols = await session.execute!({ statement: 'SELECT foto FROM alunos LIMIT 1' });
    assert.equal(cols.columns.length, 1);
  } finally {
    await session.close();
  }
});

test('acrescentar coluna: o comando gerado roda e a coluna aparece', async () => {
  const { session } = await abrir();
  try {
    const r = await session.alterStructure!({
      nodePath: ALVO,
      operacao: {
        tipo: 'acrescentar-coluna', coluna: 'idade', tipoSql: 'INTEGER',
        obrigatoria: false, padrao: '0',
      },
    });
    await session.execute!({ statement: semComentarios(r.sql) });

    const e = await session.tableStructure!(ALVO);
    const nova = e.colunas.find((c) => c.name === 'idade');
    assert.equal(nova?.type, 'INTEGER');
    assert.equal(nova?.padrao, '0');
  } finally {
    await session.close();
  }
});

test('criar e apagar índice: os dois comandos rodam', async () => {
  const { session } = await abrir();
  try {
    const criar = await session.alterStructure!({
      nodePath: ALVO,
      operacao: { tipo: 'criar-indice', nome: 'idx_teste', colunas: ['nome'], unico: true },
    });
    await session.execute!({ statement: semComentarios(criar.sql) });

    let e = await session.tableStructure!(ALVO);
    let indices = 'itens' in e.indices ? e.indices.itens : [];
    assert.equal(indices.some((i) => i.nome === 'idx_teste'), true);

    const apagar = await session.alterStructure!({
      nodePath: ALVO,
      operacao: { tipo: 'apagar-indice', nome: 'idx_teste' },
    });
    await session.execute!({ statement: semComentarios(apagar.sql) });

    e = await session.tableStructure!(ALVO);
    indices = 'itens' in e.indices ? e.indices.itens : [];
    assert.equal(indices.some((i) => i.nome === 'idx_teste'), false);
  } finally {
    await session.close();
  }
});

test('renomear coluna: o comando roda e o nome muda', async () => {
  const { session } = await abrir();
  try {
    const r = await session.alterStructure!({
      nodePath: ALVO,
      operacao: { tipo: 'renomear-coluna', coluna: 'foto', novo: 'imagem' },
    });
    await session.execute!({ statement: semComentarios(r.sql) });

    const e = await session.tableStructure!(ALVO);
    assert.equal(e.colunas.some((c) => c.name === 'imagem'), true);
    assert.equal(e.colunas.some((c) => c.name === 'foto'), false);
  } finally {
    await session.close();
  }
});

test('o SQLite recusa o que não faz, mesmo pedindo pela rota', async () => {
  // Esconder o botão não basta.
  const { session } = await abrir();
  try {
    await assert.rejects(
      () => session.alterStructure!({
        nodePath: ALVO,
        operacao: {
          tipo: 'alterar-coluna', coluna: 'nome', tipoSql: 'TEXT',
          obrigatoria: true, padrao: null,
        },
      }),
      /SQLite não faz/i
    );
  } finally {
    await session.close();
  }
});

test('as capacidades declaradas batem com o que o driver aceita', async () => {
  const { session } = await abrir();
  try {
    const caps = session.alterCapabilities!();
    assert.equal(caps.dialeto, 'SQLite');
    assert.equal(caps.operacoes.includes('acrescentar-coluna'), true);
    assert.equal(caps.operacoes.includes('alterar-coluna'), false);
  } finally {
    await session.close();
  }
});
