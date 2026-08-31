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

// ---------------------------------------------------------------------------
// Classes de caractere (T042, spec 073)
// ---------------------------------------------------------------------------
//
// A desculpa que eu tinha escrito no rodapé do módulo era *"raríssimas em
// `.gitignore` de projeto, e o custo de acertar os casos de borda não se
// paga"*. Ele mandou fazer, e o custo é este arquivo: as bordas viram teste.

test('classe simples casa qualquer um dos caracteres', () => {
  const r = com('arquivo[123].txt');
  assert.equal(ig('arquivo1.txt', r), true);
  assert.equal(ig('arquivo3.txt', r), true);
  assert.equal(ig('arquivo4.txt', r), false);
  assert.equal(ig('arquivo.txt', r), false, 'a classe casa UM caractere, não zero');
});

test('intervalo casa a faixa inteira', () => {
  const r = com('log[0-9].txt');
  assert.equal(ig('log0.txt', r), true);
  assert.equal(ig('log7.txt', r), true);
  assert.equal(ig('loga.txt', r), false);
});

test('classe NEGADA casa o que está fora dela', () => {
  const r = com('t[!e]ste.txt');
  assert.equal(ig('taste.txt', r), true);
  assert.equal(ig('teste.txt', r), false);
});

test('`^` também nega, como na expressão regular', () => {
  // O git documenta `!`, mas aceita `^`. Recusar seria recusar `.gitignore`
  // que já funciona no git.
  const r = com('t[^e]ste.txt');
  assert.equal(ig('taste.txt', r), true);
  assert.equal(ig('teste.txt', r), false);
});

test('a classe NUNCA casa a barra', () => {
  // Sem isto, `a[b/c]d` viraria um padrão que atravessa pasta — e um caminho
  // fundo seria ignorado por engano.
  const r = com('a[/]b');
  assert.equal(ig('a/b', r), false);
});

test('colchete sem fechamento é caractere literal', () => {
  // É o que o git faz: um `[` solto não vira classe aberta até o fim da linha.
  const r = com('a[b.txt');
  assert.equal(ig('a[b.txt', r), true);
  assert.equal(ig('ab.txt', r), false);
});

test('`]` logo no começo da classe é literal', () => {
  const r = com('a[]]b');
  assert.equal(ig('a]b', r), true);
});

test('caractere especial de regex dentro da classe não escapa dela', () => {
  const r = com('v[.-]1');
  assert.equal(ig('v.1', r), true);
  assert.equal(ig('v-1', r), true);
  assert.equal(ig('vx1', r), false, 'o ponto dentro da classe é literal');
});

test('classe combinada com estrela continua sem atravessar barra', () => {
  const r = com('*[0-9].log');
  assert.equal(ig('build/saida1.log', r), true, 'sem barra no padrão, vale em qualquer nível');
  assert.equal(ig('saida1.log', r), true);
  assert.equal(ig('saida.log', r), false);
});
