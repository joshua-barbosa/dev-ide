// Datas do SQL Server no texto do próprio SQL Server, sem conversão (spec 110).
//
// O `tedious` não sabe devolver texto: entrega `Date` com os dígitos da coluna
// nos campos UTC (`useUTC`, o padrão) e a fração além do milissegundo num campo
// à parte. Estes testes montam o valor do MESMO jeito que ele monta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textoDaData } from '../connections/drivers/sqlserver-datas';

/** Como o `tedious` entrega: dígitos no UTC + `nanosecondsDelta` em segundos. */
function comoOTedious(iso: string, ticksAlemDoMs = 0): Date {
  const d = new Date(`${iso}Z`);
  Object.defineProperty(d, 'nanosecondsDelta', { enumerable: false, value: ticksAlemDoMs / 1e7 });
  return d;
}

const tipo = (name: string, extra: { scale?: number; dataLength?: number } = {}) =>
  ({ type: { name }, ...extra });

test('datetime: os dígitos gravados, sem T e sem Z', () => {
  assert.equal(textoDaData(comoOTedious('2026-09-25T11:19:41.208'), tipo('DateTime')),
    '2026-09-25 11:19:41.208');
});

test('datetime anulável (DateTimeN de 8 bytes) é datetime', () => {
  assert.equal(textoDaData(comoOTedious('2026-09-25T11:19:41.208'), tipo('DateTimeN', { dataLength: 8 })),
    '2026-09-25 11:19:41.208');
});

test('smalldatetime (inclusive anulável, 4 bytes) não tem fração', () => {
  const v = comoOTedious('2026-09-25T11:19:00.000');
  assert.equal(textoDaData(v, tipo('SmallDateTime')), '2026-09-25 11:19:00');
  assert.equal(textoDaData(v, tipo('DateTimeN', { dataLength: 4 })), '2026-09-25 11:19:00');
});

test('date é só o dia — nada de meia-noite com fuso', () => {
  assert.equal(textoDaData(comoOTedious('2026-09-25T00:00:00.000'), tipo('Date')), '2026-09-25');
});

test('datetime2(7) mostra os sete dígitos, inclusive os além do milissegundo', () => {
  assert.equal(textoDaData(comoOTedious('2026-09-25T11:19:41.208', 4567), tipo('DateTime2', { scale: 7 })),
    '2026-09-25 11:19:41.2084567');
});

test('datetime2 respeita a escala declarada', () => {
  const v = comoOTedious('2026-09-25T11:19:41.208');
  assert.equal(textoDaData(v, tipo('DateTime2', { scale: 3 })), '2026-09-25 11:19:41.208');
  assert.equal(textoDaData(v, tipo('DateTime2', { scale: 0 })), '2026-09-25 11:19:41');
});

test('time(7) é só a hora', () => {
  assert.equal(textoDaData(comoOTedious('1970-01-01T11:19:41.208', 4567), tipo('Time', { scale: 7 })),
    '11:19:41.2084567');
});

test('datetimeoffset: o instante com o fuso DITO, porque o driver descarta o original', () => {
  // O `tedious` lê o fuso da coluna e o joga fora (value-parser.js,
  // readDateTimeOffset). O que sobra é o instante em UTC — e ele sai com
  // `+00:00` escrito, para ninguém confundir com a hora local gravada.
  assert.equal(textoDaData(comoOTedious('2026-09-25T14:19:41.208'), tipo('DateTimeOffset', { scale: 3 })),
    '2026-09-25 14:19:41.208 +00:00');
});

test('o que não é data passa intacto', () => {
  assert.equal(textoDaData('texto', tipo('NVarChar')), 'texto');
  assert.equal(textoDaData(42, tipo('Int')), 42);
  assert.equal(textoDaData(null, tipo('DateTime')), null);
});
