// A configuração do Emmet (T022).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMMET_PADRAO, lerConfiguracaoDoEmmet, LINGUAGENS_PADRAO, sintaxeDoDialeto,
} from '../emmet';

test('sem configuração, valem os padrões', () => {
  for (const bruto of [null, undefined, 7, 'x', [], {}]) {
    assert.deepEqual(lerConfiguracaoDoEmmet(bruto), EMMET_PADRAO);
  }
});

test('as linguagens declaradas SUBSTITUEM as padrão daquele dialeto', () => {
  const c = lerConfiguracaoDoEmmet({ linguagens: { html: ['html', 'php', 'twig'] } });
  assert.deepEqual(c.linguagens.html, ['html', 'php', 'twig']);
  assert.deepEqual(c.linguagens.css, LINGUAGENS_PADRAO.css, 'o que ele não disse fica');
});

test('lista VAZIA desliga o dialeto; ausente cai no padrão', () => {
  const c = lerConfiguracaoDoEmmet({ linguagens: { css: [] } });
  assert.deepEqual(c.linguagens.css, [], 'vazia é escolha');
  assert.deepEqual(c.linguagens.html, LINGUAGENS_PADRAO.html, 'ausente é padrão');
});

test('entrada torta na lista some, e o resto fica', () => {
  const c = lerConfiguracaoDoEmmet({ linguagens: { html: ['html', 7, '', '  php  '] } });
  assert.deepEqual(c.linguagens.html, ['html', 'php']);
});

test('snippet do usuário entra por dialeto', () => {
  const c = lerConfiguracaoDoEmmet({
    snippets: { html: { card: 'div.card>div.card-body>h5.card-title' } },
  });
  assert.equal(c.snippets.html.card, 'div.card>div.card-body>h5.card-title');
  assert.deepEqual(c.snippets.css, {});
});

test('abreviação com espaço é descartada — ela nunca dispararia', () => {
  const c = lerConfiguracaoDoEmmet({ snippets: { html: { 'com espaco': 'div', ok: 'p' } } });
  assert.deepEqual(Object.keys(c.snippets.html), ['ok']);
});

test('expansão vazia ou que não é texto é descartada', () => {
  const c = lerConfiguracaoDoEmmet({ snippets: { html: { a: '', b: 7, c: 'div' } } });
  assert.deepEqual(Object.keys(c.snippets.html), ['c']);
});

test('JSX usa os snippets de HTML — é HTML com outro atributo', () => {
  assert.equal(sintaxeDoDialeto('html'), 'html');
  assert.equal(sintaxeDoDialeto('jsx'), 'html');
  assert.equal(sintaxeDoDialeto('css'), 'css');
});

test('o padrão do HTML já cobre Blade (T041)', () => {
  // `.blade.php` abre como PHP no Monaco, e `php` está no padrão.
  assert.ok(LINGUAGENS_PADRAO.html.includes('php'));
});
