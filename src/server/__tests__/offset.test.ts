// A paginação do RESULTADO de uma query (T056), contra o SQLite de verdade.
//
// Na spec 041 eu escrevi que paginar um `SELECT` arbitrário mente, porque
// envolvê-lo num `COUNT(*)` dá número errado com `GROUP BY` ou `LIMIT` próprio.
// Continua verdade — e é por isso que aqui NÃO há total: há página, e só.
//
// O SQL do usuário também não é reescrito. Envolvê-lo num `SELECT * FROM (…)`
// quebraria em consulta com colunas homônimas (`select a.id, b.id`), que é erro
// de tabela derivada nos três dialetos. O driver descarta as primeiras linhas
// do fluxo que ele já lê.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteDriver } from '../connections/drivers/sqlite';
import type { Session } from '../connections/types';

async function comBanco(quantas: number, tarefa: (s: Session) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'offset-'));
  const arquivo = join(dir, 'teste.db');
  const db = new DatabaseSync(arquivo);
  db.exec('CREATE TABLE numeros (n INTEGER PRIMARY KEY)');
  const inserir = db.prepare('INSERT INTO numeros(n) VALUES (?)');
  for (let i = 1; i <= quantas; i += 1) inserir.run(i);
  db.close();

  const sessao = await sqliteDriver.connect({
    id: 'x', type: 'sqlite', label: 'teste', group: '', readOnly: false,
    fields: { file: arquivo },
  } as never);
  try {
    await tarefa(sessao);
  } finally {
    await sessao.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a segunda página começa onde a primeira parou', async () => {
  await comBanco(25, async (s) => {
    const p1 = await s.execute!({ statement: 'SELECT n FROM numeros ORDER BY n', rowLimit: 10 });
    const p2 = await s.execute!({
      statement: 'SELECT n FROM numeros ORDER BY n', rowLimit: 10, offset: 10,
    });
    assert.deepEqual(p1.rows.map((l) => l[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(p2.rows.map((l) => l[0]), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

test('a última página vem incompleta e diz que NÃO há mais', async () => {
  await comBanco(25, async (s) => {
    const p3 = await s.execute!({
      statement: 'SELECT n FROM numeros ORDER BY n', rowLimit: 10, offset: 20,
    });
    assert.equal(p3.rows.length, 5);
    // `truncated: false` é o que apaga o botão de próxima página.
    assert.equal(p3.truncated, false);
  });
});

test('página além do fim vem vazia, e não em erro', async () => {
  await comBanco(5, async (s) => {
    const r = await s.execute!({
      statement: 'SELECT n FROM numeros', rowLimit: 10, offset: 100,
    });
    assert.equal(r.rows.length, 0);
    assert.equal(r.truncated, false);
  });
});

test('offset zero e ausente dão o mesmo — o caminho de sempre não muda', async () => {
  await comBanco(5, async (s) => {
    const sem = await s.execute!({ statement: 'SELECT n FROM numeros ORDER BY n', rowLimit: 3 });
    const zero = await s.execute!({
      statement: 'SELECT n FROM numeros ORDER BY n', rowLimit: 3, offset: 0,
    });
    assert.deepEqual(sem.rows, zero.rows);
  });
});

test('offset negativo é aparado, e não vira leitura para trás', async () => {
  await comBanco(5, async (s) => {
    const r = await s.execute!({
      statement: 'SELECT n FROM numeros ORDER BY n', rowLimit: 2, offset: -5,
    });
    assert.deepEqual(r.rows.map((l) => l[0]), [1, 2]);
  });
});

test('o SQL do usuário NÃO é reescrito: colunas homônimas continuam funcionando', async () => {
  // `select a.n, b.n` numa tabela derivada seria erro de coluna duplicada nos
  // três dialetos. Como não há tabela derivada, isto passa.
  await comBanco(3, async (s) => {
    const r = await s.execute!({
      statement: 'SELECT a.n, b.n FROM numeros a, numeros b WHERE a.n = b.n ORDER BY a.n',
      rowLimit: 2,
      offset: 1,
    });
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.rows[0], [2, 2]);
  });
});
