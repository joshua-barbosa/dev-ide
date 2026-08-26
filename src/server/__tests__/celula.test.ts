import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cortarParaOVisor, montarLeituraDeCelula, MAX_CELULA_CHARS,
} from '../connections/drivers/celula';
import type { AlvoDeEscrita } from '../connections/drivers/escrita';

const MYSQL: AlvoDeEscrita = {
  alvo: '`app`.`logs`',
  estilo: 'backtick',
  marcador: 'interrogacao',
  colunas: [
    { name: 'id', chave: true },
    { name: 'dados', chave: false },
  ],
};

const PG: AlvoDeEscrita = {
  alvo: '"public"."logs"',
  estilo: 'double',
  marcador: 'numerado',
  colunas: [
    { name: 'id', chave: true },
    { name: 'tenant', chave: true },
    { name: 'dados', chave: false },
  ],
};

test('monta o SELECT da coluna pedida, com a chave no WHERE', () => {
  const c = montarLeituraDeCelula(MYSQL, 'dados', { id: 7 });
  assert.equal(c.sql, 'SELECT `dados` FROM `app`.`logs` WHERE `id` = ?');
  assert.deepEqual(c.params, [7]);
});

test('chave composta entra inteira, com marcador numerado no Postgres', () => {
  const c = montarLeituraDeCelula(PG, 'dados', { id: 7, tenant: 'x' });
  assert.equal(c.sql, 'SELECT "dados" FROM "public"."logs" WHERE "id" = $1 AND "tenant" = $2');
  assert.deepEqual(c.params, [7, 'x']);
});

test('o VALOR nunca entra no SQL — vai sempre como parâmetro', () => {
  const c = montarLeituraDeCelula(MYSQL, 'dados', { id: "1 OR 1=1; DROP TABLE logs--" });
  assert.ok(!c.sql.includes('DROP'));
  assert.deepEqual(c.params, ["1 OR 1=1; DROP TABLE logs--"]);
});

test('coluna que não existe é recusada, e não citada às cegas', () => {
  assert.throws(
    () => montarLeituraDeCelula(MYSQL, 'dados`, (select 1) as x, `id', { id: 1 }),
    /Coluna desconhecida/
  );
});

test('chave nula vira IS NULL, e não `= ?` — que nunca casaria', () => {
  const c = montarLeituraDeCelula(MYSQL, 'dados', { id: null });
  assert.equal(c.sql, 'SELECT `dados` FROM `app`.`logs` WHERE `id` IS NULL');
  assert.deepEqual(c.params, []);
});

test('chave incompleta é recusada: o WHERE casaria com várias linhas', () => {
  assert.throws(() => montarLeituraDeCelula(PG, 'dados', { id: 7 }), /Faltou a chave: tenant/);
});

test('coluna que não é chave no WHERE é recusada', () => {
  assert.throws(() => montarLeituraDeCelula(MYSQL, 'dados', { id: 1, dados: 'x' }), /Não é chave: dados/);
});

test('tabela sem chave primária é recusada com o motivo por extenso', () => {
  const semChave: AlvoDeEscrita = { ...MYSQL, colunas: [{ name: 'dados', chave: false }] };
  assert.throws(() => montarLeituraDeCelula(semChave, 'dados', {}), /não declara chave primária/);
});

test('o visor tem teto próprio, e diz quando cortou', () => {
  assert.deepEqual(cortarParaOVisor('curto'), { valor: 'curto', cortadoEm: null });
  const enorme = 'x'.repeat(MAX_CELULA_CHARS + 10);
  const r = cortarParaOVisor(enorme);
  assert.equal(r.cortadoEm, MAX_CELULA_CHARS);
  assert.equal((r.valor as string).length, MAX_CELULA_CHARS);
});

test('número e null passam sem corte', () => {
  assert.deepEqual(cortarParaOVisor(42), { valor: 42, cortadoEm: null });
  assert.deepEqual(cortarParaOVisor(null), { valor: null, cortadoEm: null });
});
