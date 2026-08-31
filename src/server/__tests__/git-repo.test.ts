// O `.gitignore` global e o índice do git (T042, spec 073).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { caminhosDeExclusaoGlobal, lerExcludesFile, lerIndice } from '../git-repo';

// ---- o `excludesfile` do `.gitconfig` ----

test('lê o excludesfile declarado em [core]', () => {
  const ini = '[user]\n\tname = alguem\n[core]\n\texcludesfile = /etc/gitignore\n';
  assert.equal(lerExcludesFile(ini, '/casa'), '/etc/gitignore');
});

test('o til é expandido, como o git faz', () => {
  assert.equal(lerExcludesFile('[core]\nexcludesfile = ~/meu-ignore\n', '/casa'), '/casa/meu-ignore');
  assert.equal(lerExcludesFile('[core]\nexcludesfile = ~\n', '/casa'), '/casa');
});

test('a chave FORA de [core] não vale', () => {
  const ini = '[alias]\n\texcludesfile = /nao/e/aqui\n';
  assert.equal(lerExcludesFile(ini, '/casa'), null);
});

test('subseção de core ainda é core', () => {
  assert.equal(lerExcludesFile('[core "x"]\nexcludesfile = /a\n', '/casa'), '/a');
});

test('maiúsculas e aspas não atrapalham', () => {
  assert.equal(lerExcludesFile('[CORE]\nExcludesFile = "/a b"\n', '/casa'), '/a b');
});

test('comentário e linha vazia são ignorados', () => {
  const ini = '# nada\n; nada\n\n[core]\n  excludesfile = /a\n';
  assert.equal(lerExcludesFile(ini, '/casa'), '/a');
});

test('sem excludesfile, devolve null', () => {
  assert.equal(lerExcludesFile('[core]\n\tautocrlf = input\n', '/casa'), null);
});

// ---- onde procurar ----

const existeTudo = () => true;

test('a ordem é gitconfig, padrão XDG e info/exclude por último', () => {
  // O `.git/info/exclude` é o mais específico dos três, e a última regra que
  // casa é a que vence.
  const r = caminhosDeExclusaoGlobal(
    '/proj',
    { home: '/casa' },
    existeTudo,
    () => '[core]\nexcludesfile = /declarado\n'
  );
  assert.deepEqual(r, ['/declarado', '/casa/.config/git/ignore', '/proj/.git/info/exclude']);
});

test('XDG_CONFIG_HOME vence o ~/.config', () => {
  const r = caminhosDeExclusaoGlobal('/proj', { home: '/casa', xdg: '/xdg' }, existeTudo, () => '');
  assert.ok(r.includes('/xdg/git/ignore'));
  assert.ok(!r.includes('/casa/.config/git/ignore'));
});

test('o que não existe não entra na lista', () => {
  const r = caminhosDeExclusaoGlobal(
    '/proj',
    { home: '/casa' },
    (c) => c === path.join('/proj', '.git', 'info', 'exclude'),
    () => ''
  );
  assert.deepEqual(r, ['/proj/.git/info/exclude']);
});

// ---- o índice ----

/** Monta um `.git/index` v2 de mentira, com os nomes dados. */
function indiceFalso(nomes: readonly string[], versao = 2): Buffer {
  const cabecalho = Buffer.alloc(12);
  cabecalho.write('DIRC', 0, 'latin1');
  cabecalho.writeUInt32BE(versao, 4);
  cabecalho.writeUInt32BE(nomes.length, 8);

  const entradas = nomes.map((nome) => {
    const bytes = Buffer.from(nome, 'utf8');
    const bruto = 62 + bytes.length;
    const tamanho = Math.ceil((bruto + 1) / 8) * 8;
    const e = Buffer.alloc(tamanho);
    e.writeUInt16BE(Math.min(bytes.length, 0x0fff), 60);
    bytes.copy(e, 62);
    return e;
  });
  return Buffer.concat([cabecalho, ...entradas]);
}

test('lê os caminhos rastreados', () => {
  const r = lerIndice(indiceFalso(['src/a.ts', 'README.md']));
  assert.deepEqual(r, ['src/a.ts', 'README.md']);
});

test('índice vazio é lista vazia, e não erro', () => {
  assert.deepEqual(lerIndice(indiceFalso([])), []);
});

test('nome longo, além do limite dos 12 bits, ainda é lido', () => {
  const longo = `src/${'x'.repeat(5000)}.ts`;
  assert.deepEqual(lerIndice(indiceFalso([longo])), [longo]);
});

test('nome com acento volta em UTF-8', () => {
  assert.deepEqual(lerIndice(indiceFalso(['pastas/ação.ts'])), ['pastas/ação.ts']);
});

test('assinatura errada devolve null', () => {
  const b = indiceFalso(['a.ts']);
  b.write('XXXX', 0, 'latin1');
  assert.equal(lerIndice(b), null);
});

test('a versão 4 devolve null, e não lixo', () => {
  // Ela comprime os nomes com prefixo e varint. Ler errado seria pior que não
  // ler: caminho torto viraria "rastreado" e desligaria o .gitignore dele.
  assert.equal(lerIndice(indiceFalso(['a.ts'], 4)), null);
});

test('arquivo truncado devolve null', () => {
  const b = indiceFalso(['src/a.ts']);
  assert.equal(lerIndice(b.subarray(0, 40)), null);
});

test('buffer pequeno demais devolve null', () => {
  assert.equal(lerIndice(Buffer.alloc(4)), null);
});
