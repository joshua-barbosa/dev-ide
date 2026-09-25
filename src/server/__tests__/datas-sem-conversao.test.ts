// Data e hora chegam à tela como o banco as devolveu, sem conversão (spec 110).
//
// Ele: *"se eu to consultando uma query do banco, tem que me mostrar exatamente
// o que está na linha"* e *"não converter horário seja o que for"*. A prova de
// ponta a ponta precisa de bancos de verdade (`npm run conferir:datas`); aqui
// fica o que dá para conferir sem rede: que os tipos de data do PostgreSQL não
// passam pelo analisador que os transforma em `Date`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIPOS_SEM_CONVERSAO } from '../connections/drivers/postgres-tipos';

const OIDS = {
  date: 1082, timestamp: 1114, timestamptz: 1184,
  'date[]': 1182, 'timestamp[]': 1115, 'timestamptz[]': 1185,
};

for (const [nome, oid] of Object.entries(OIDS)) {
  test(`${nome} volta como TEXTO, igual ao que o banco mandou`, () => {
    const analisar = TIPOS_SEM_CONVERSAO.getTypeParser(oid, 'text') as (v: string) => unknown;
    const cru = nome.endsWith('[]') ? '{"2026-09-25 11:19:41.208"}' : '2026-09-25 11:19:41.208';
    assert.equal(analisar(cru), cru);
  });
}

test('os outros tipos continuam com o analisador de sempre', () => {
  // int4: sem isto, um número viraria texto e a grade perderia o alinhamento.
  const analisar = TIPOS_SEM_CONVERSAO.getTypeParser(23, 'text') as (v: string) => unknown;
  assert.equal(analisar('42'), 42);
});
