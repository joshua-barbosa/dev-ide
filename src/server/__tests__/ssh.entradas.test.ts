import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ehExecutavel,
  entradaDe,
  filtrarOcultos,
  lerPasswd,
  modoOctal,
  ordenarEntradas,
  tipoDoModo,
  usuariosDe,
  type EntradaRemota,
} from '../connections/drivers/ssh-entradas';

// ---------------------------------------------------------------------------
// O modo POSIX
// ---------------------------------------------------------------------------

test('o tipo sai dos bits altos do modo', () => {
  assert.equal(tipoDoModo(0o040755), 'folder');
  assert.equal(tipoDoModo(0o100644), 'file');
  assert.equal(tipoDoModo(0o120777), 'link');
  // Sem modo, o palpite seguro é arquivo: pasta desenharia seta de expandir
  // onde não há nada para expandir.
  assert.equal(tipoDoModo(undefined), 'file');
});

test('a permissão sai em octal de quatro dígitos', () => {
  assert.equal(modoOctal(0o100644), '0644');
  assert.equal(modoOctal(0o040755), '0755');
  // Com setuid, o quarto dígito deixa de ser zero — é por isso que são quatro.
  assert.equal(modoOctal(0o104755), '4755');
  assert.equal(modoOctal(undefined), undefined);
});

test('executável é arquivo com QUALQUER bit de execução', () => {
  assert.equal(ehExecutavel(0o100755), true);
  assert.equal(ehExecutavel(0o100744), true);
  assert.equal(ehExecutavel(0o100001), true, 'só o "outros" já conta');
  assert.equal(ehExecutavel(0o100644), false);
  // Em pasta o bit `x` quer dizer "pode entrar", que é outra coisa.
  assert.equal(ehExecutavel(0o040755), false);
});

// ---------------------------------------------------------------------------
// A entrada
// ---------------------------------------------------------------------------

const DONOS = new Map([[0, 'root'], [1001, 'ana.silva']]);

test('a entrada junta caminho, dono, tamanho e datas', () => {
  const e = entradaDe(
    '/opt',
    {
      filename: 'run.sh',
      attrs: { mode: 0o100755, size: 1490, uid: 1001, mtime: 1_760_000_000, atime: 1_770_000_000 },
    },
    DONOS
  );
  assert.equal(e.path, '/opt/run.sh');
  assert.equal(e.kind, 'file');
  assert.equal(e.size, 1490);
  assert.equal(e.owner, 'ana.silva');
  assert.equal(e.executable, true);
  // Segundos no protocolo, milissegundos no contrato.
  assert.equal(e.modifiedAt, 1_760_000_000_000);
  assert.equal(e.accessedAt, 1_770_000_000_000);
});

test('pasta não mostra tamanho', () => {
  // O tamanho de um diretório é o do próprio diretório no disco, e ao lado do
  // nome ele se confunde com "o que tem dentro".
  const e = entradaDe('/', { filename: 'etc', attrs: { mode: 0o040755, size: 4096 } }, DONOS);
  assert.equal(e.size, null);
});

test('uid desconhecido aparece pelo NÚMERO, e não em branco', () => {
  const e = entradaDe('/', { filename: 'x', attrs: { mode: 0o100644, uid: 4242 } }, DONOS);
  assert.equal(e.owner, '4242');
});

test('tempo ausente ou zero vira null, e não 1970', () => {
  const e = entradaDe('/', { filename: 'x', attrs: { mode: 0o100644, mtime: 0 } }, DONOS);
  assert.equal(e.modifiedAt, null);
  assert.equal(e.accessedAt, null);
});

// ---------------------------------------------------------------------------
// Ordem e ocultos
// ---------------------------------------------------------------------------

const fabricar = (nome: string, kind: EntradaRemota['kind']): EntradaRemota => ({
  name: nome, path: `/${nome}`, kind, size: null, modifiedAt: null,
  accessedAt: null, executable: false,
});

test('pastas primeiro, depois o resto em ordem de gente', () => {
  const lista = [
    fabricar('zebra', 'file'), fabricar('Ácido', 'file'),
    fabricar('var', 'folder'), fabricar('bin', 'link'), fabricar('etc', 'folder'),
  ];
  assert.deepEqual(
    ordenarEntradas(lista).map((e) => e.name),
    ['etc', 'var', 'Ácido', 'bin', 'zebra']
  );
});

test('esconder ocultos tira só os que começam com ponto', () => {
  const lista = [fabricar('.env', 'file'), fabricar('app', 'folder')];
  assert.deepEqual(filtrarOcultos(lista, true).length, 2);
  assert.deepEqual(filtrarOcultos(lista, false).map((e) => e.name), ['app']);
});

// ---------------------------------------------------------------------------
// /etc/passwd
// ---------------------------------------------------------------------------

// A FORMA é a de um Debian real (conferida contra o servidor do usuário em
// 2026-08-24); os nomes são inventados.
const PASSWD = [
  'root:x:0:0:root:/root:/bin/bash',
  'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
  'sync:x:4:65534:sync:/bin:/bin/sync',
  'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
  '_apt:x:42:65534::/nonexistent:/usr/sbin/nologin',
  'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
  'systemd-network:x:998:998:...:/:/usr/sbin/nologin',
  'dhcpcd:x:100:65534:...:/usr/lib/dhcpcd:/bin/false',
  'redis:x:101:101::/var/lib/redis:/usr/sbin/nologin',
  'ana.silva:x:1001:1001::/home/ana.silva:/bin/bash',
  'bruno.costa:x:1002:1002::/home/bruno.costa:/bin/bash',
  'carla.dias:x:1003:1003::/home/carla.dias:/bin/bash',
  'diego.eloi:x:1004:1004::/home/diego.eloi:/bin/bash',
  'elisa.faria:x:1000:1000::/home/elisa.faria:/bin/bash',
  'fabio.gomes:x:1005:1005::/home/fabio.gomes:/bin/bash',
  '',
].join('\n');

test('o mapa de dono cobre uid de serviço e de gente', () => {
  const mapa = lerPasswd(PASSWD);
  assert.equal(mapa.get(0), 'root');
  assert.equal(mapa.get(33), 'www-data');
  assert.equal(mapa.get(1001), 'ana.silva');
  assert.equal(mapa.get(9999), undefined);
});

test('/etc/passwd estragado não derruba a leitura', () => {
  const mapa = lerPasswd('# comentário\nlinha curta\n:x::\nok:x:7:7::/h:/bin/sh');
  assert.equal(mapa.get(7), 'ok');
});

test('o nó Users lista root e as contas de gente — e mais nada', () => {
  // Um Debian tem ~34 linhas em /etc/passwd. Listar todas viraria um despejo:
  // o que se quer ali é chegar rápido na casa de alguém.
  const nomes = usuariosDe(PASSWD).map((u) => u.nome);
  assert.deepEqual(nomes, [
    'ana.silva', 'bruno.costa', 'carla.dias', 'diego.eloi',
    'elisa.faria', 'fabio.gomes', 'root',
  ]);
  // Sete — exatamente o que a tela de referência mostra no servidor dele.
  assert.equal(nomes.length, 7);
});

test('o Users traz o HOME, que é para onde o nó leva', () => {
  const ana = usuariosDe(PASSWD).find((u) => u.nome === 'ana.silva');
  assert.equal(ana?.home, '/home/ana.silva');
  assert.equal(usuariosDe(PASSWD).find((u) => u.nome === 'root')?.home, '/root');
});
