import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entradaDeFtp,
  tipoDoFtp,
  TIPO_ARQUIVO,
  TIPO_LINK,
  TIPO_PASTA,
} from '../connections/drivers/ftp-entradas';

test('os três tipos do FTP viram os três do contrato', () => {
  assert.equal(tipoDoFtp(TIPO_PASTA), 'folder');
  assert.equal(tipoDoFtp(TIPO_ARQUIVO), 'file');
  assert.equal(tipoDoFtp(TIPO_LINK), 'link');
  // `Unknown` (0) vira arquivo: pasta desenharia seta de expandir onde pode não
  // haver nada para expandir.
  assert.equal(tipoDoFtp(0), 'file');
});

test('a entrada junta caminho, tamanho, data e dono', () => {
  const e = entradaDeFtp('/pub', {
    name: 'leiame.txt',
    type: TIPO_ARQUIVO,
    size: 2048,
    modifiedAt: new Date('2026-07-14T09:05:00Z'),
    user: 'ftpuser',
  });
  assert.equal(e.path, '/pub/leiame.txt');
  assert.equal(e.size, 2048);
  assert.equal(e.owner, 'ftpuser');
  assert.equal(e.modifiedAt, Date.parse('2026-07-14T09:05:00Z'));
});

test('pasta não mostra tamanho', () => {
  const e = entradaDeFtp('/', { name: 'pub', type: TIPO_PASTA, size: 4096 });
  assert.equal(e.size, null);
});

test('o que o servidor NÃO contou vira null, e não um valor inventado', () => {
  // Servidor Windows não dá dono; servidor antigo não dá hora.
  const e = entradaDeFtp('/', { name: 'x.txt', type: TIPO_ARQUIVO, size: 1 });
  assert.equal(e.modifiedAt, null);
  assert.equal(e.owner, undefined);
});

test('data inválida vira null em vez de 1970', () => {
  const e = entradaDeFtp('/', {
    name: 'x',
    type: TIPO_ARQUIVO,
    size: 1,
    modifiedAt: new Date('nao é data'),
  });
  assert.equal(e.modifiedAt, null);
});

test('nada por FTP é executável — não há como executar por FTP', () => {
  const e = entradaDeFtp('/', { name: 'run.sh', type: TIPO_ARQUIVO, size: 10 });
  assert.equal(e.executable, false);
});
