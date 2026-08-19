import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ignorado, lerRegras, REGRAS_PADRAO } from '../gitignore';

const com = (texto: string) => lerRegras(texto);
const ig = (caminho: string, regras = REGRAS_PADRAO, ehPasta = false) =>
  ignorado(caminho, ehPasta, regras);

test('pasta padrão é ignorada, e o que está dentro dela também', () => {
  assert.equal(ig('node_modules', REGRAS_PADRAO, true), true);
  assert.equal(ig('node_modules/react/index.js'), true);
  assert.equal(ig('.venv/lib/python3.12/site.py'), true);
  assert.equal(ig('vendor/laravel/framework/src/Foo.php'), true);
  assert.equal(ig('src/app.ts'), false);
});

test('pasta ignorada em qualquer profundidade, não só na raiz', () => {
  // Um monorepo tem um `node_modules` por pacote.
  assert.equal(ig('pacotes/api/node_modules/x/index.js'), true);
  assert.equal(ig('backend/.venv/bin/activate'), true);
});

test('ARQUIVO com o nome de uma pasta ignorada não é ignorado', () => {
  // `dist/` termina em barra: fala de pasta. Um arquivo `dist` é outra coisa.
  assert.equal(ig('dist', REGRAS_PADRAO, false), false);
  assert.equal(ig('dist', REGRAS_PADRAO, true), true);
});

test('comentário e linha em branco não viram regra', () => {
  const regras = com('# comentário\n\n   \nsegredo.txt\n');
  assert.equal(regras.length, 1);
  assert.equal(ig('segredo.txt', regras), true);
});

test('padrão sem barra vale em qualquer profundidade', () => {
  const regras = com('*.log');
  assert.equal(ig('a.log', regras), true);
  assert.equal(ig('logs/2026/a.log', regras), true);
  assert.equal(ig('a.log.txt', regras), false);
});

test('barra no início ANCORA na raiz', () => {
  const regras = com('/build');
  assert.equal(ig('build', regras, true), true);
  assert.equal(ig('src/build', regras, true), false, 'só a da raiz');
});

test('`*` não atravessa barra; `**` atravessa', () => {
  assert.equal(ig('a/b.js', com('a/*.js')), true);
  assert.equal(ig('a/b/c.js', com('a/*.js')), false);
  assert.equal(ig('a/b/c.js', com('a/**/*.js')), true);
  assert.equal(ig('a/c.js', com('a/**/*.js')), true, '`**/` come zero níveis');
});

test('`?` casa um caractere só, e não a barra', () => {
  assert.equal(ig('a1.txt', com('a?.txt')), true);
  assert.equal(ig('a12.txt', com('a?.txt')), false);
  assert.equal(ig('a/b.txt', com('a?b.txt')), false);
});

test('a NEGAÇÃO reabre o que uma regra anterior fechou', () => {
  const regras = com('dist/\n!dist/manual.js');
  assert.equal(ig('dist/gerado.js', regras), true);
  assert.equal(ig('dist/manual.js', regras), false);
});

test('vence a ÚLTIMA regra que casa, como no git', () => {
  assert.equal(ig('a.log', com('!*.log\n*.log')), true);
  assert.equal(ig('a.log', com('*.log\n!*.log')), false);
});

test('ponto e outros caracteres especiais são literais', () => {
  const regras = com('a.b');
  assert.equal(ig('a.b', regras), true);
  assert.equal(ig('axb', regras), false, 'o ponto não é curinga');
});

test('as regras padrão não pegam código de verdade', () => {
  for (const caminho of [
    'src/index.ts', 'app/models/user.py', 'README.md', '.env',
    'tests/test_api.py', 'public/index.php', '.github/workflows/ci.yml',
  ]) {
    assert.equal(ig(caminho), false, `${caminho} não devia ser ignorado`);
  }
});
