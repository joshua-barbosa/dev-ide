import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escaparHtml, renderizarMarkdown, temPreview, urlSegura } from '../markdown';

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------
//
// Estes testes são a razão de o módulo existir. O `marked` cru **não** é seguro
// para conteúdo arbitrário: por padrão ele repassa HTML bruto e aceita
// `javascript:` em link — conferido antes de escrever o código. A saída vai para
// `dangerouslySetInnerHTML`, então cada carga abaixo é a diferença entre ver o
// README e executar o README.

test('HTML bruto do documento vira TEXTO, nunca marcação', () => {
  const html = renderizarMarkdown('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script/i, 'o script chegou ao DOM como elemento');
  assert.match(html, /&lt;script&gt;/, 'e precisa continuar visível como texto');
});

test('as tags perigosas de sempre também viram texto', () => {
  for (const carga of [
    '<iframe src="https://exemplo.test"></iframe>',
    '<img src=x onerror="alert(1)">',
    '<svg onload="alert(1)"></svg>',
    '<object data="x"></object>',
    '<style>body{display:none}</style>',
  ]) {
    const html = renderizarMarkdown(carga);
    // O que importa é não haver TAG: as palavras `onerror` e `onload` podem
    // aparecer, e devem — escapadas, como texto que o usuário escreveu.
    assert.doesNotMatch(html, /<(iframe|img|svg|object|style)/i, carga);
    assert.match(html, /&lt;/, `${carga} precisa aparecer escapado, não sumir`);
  }
});

test('link com javascript: perde o href e vira o texto dele', () => {
  const html = renderizarMarkdown('[clique](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/i);
  // Some o link, fica o texto: sumir tudo esconderia que havia algo ali.
  assert.match(html, /clique/);
});

test('as variações do javascript: também são recusadas', () => {
  // Maiúsculas, controle no meio e espaço são os truques clássicos para burlar
  // um teste de prefixo ingênuo — o navegador resolve todos como javascript:.
  for (const href of [
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
    '\u0000javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
  ]) {
    assert.equal(urlSegura(href), null, href);
  }
});

test('imagem com esquema perigoso vira o texto alternativo', () => {
  const html = renderizarMarkdown('![alt](javascript:alert(1))');
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /alt/);
});

test('http, https e mailto passam — README sem selo fica pela metade', () => {
  assert.equal(urlSegura('https://exemplo.test/a'), 'https://exemplo.test/a');
  assert.equal(urlSegura('http://exemplo.test'), 'http://exemplo.test');
  assert.equal(urlSegura('mailto:alguem@exemplo.test'), 'mailto:alguem@exemplo.test');
});

test('URL relativa passa: ela não carrega esquema nenhum', () => {
  assert.equal(urlSegura('./docs/guia.md'), './docs/guia.md');
  assert.equal(urlSegura('#secao'), '#secao');
  assert.equal(urlSegura('imagens/logo.png'), 'imagens/logo.png');
});

test('URL vazia ou só de controle é recusada', () => {
  assert.equal(urlSegura(''), null);
  assert.equal(urlSegura('   '), null);
  assert.equal(urlSegura('\u0000\u0001'), null);
});

test('aspas no título não escapam do atributo', () => {
  const html = renderizarMarkdown('[x](https://exemplo.test "a\\" onmouseover=\\"alert(1)")');
  // A propriedade que importa: nenhuma aspa CRUA dentro do valor do atributo.
  // A palavra `onmouseover` aparece — escapada, e portanto inerte.
  assert.doesNotMatch(html, /title="[^"]*"\s+onmouseover/i, 'o atributo foi rompido');
  assert.match(html, /&quot; onmouseover=&quot;/, 'as aspas precisam estar escapadas');
});

test('link externo abre fora e sem dar acesso ao window.opener', () => {
  const html = renderizarMarkdown('[x](https://exemplo.test)');
  assert.match(html, /rel="noreferrer noopener"/);
  assert.match(html, /target="_blank"/);
});

test('escaparHtml cobre os cinco caracteres que importam', () => {
  assert.equal(escaparHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

test('títulos, ênfase e lista saem como se espera', () => {
  const html = renderizarMarkdown('# Título\n\nUm **negrito** e um *itálico*.\n\n- um\n- dois');
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<strong>negrito<\/strong>/);
  assert.match(html, /<em>itálico<\/em>/);
  assert.match(html, /<li>um<\/li>/);
});

test('tabela do GFM funciona — o README do projeto vive de tabela', () => {
  const html = renderizarMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('bloco de código preserva a linguagem e escapa o conteúdo', () => {
  const html = renderizarMarkdown('```ts\nconst a = 1 < 2;\n```');
  assert.match(html, /language-ts/);
  assert.match(html, /1 &lt; 2/, 'o conteúdo do bloco não pode virar marcação');
});

test('lista de tarefas do GFM', () => {
  const html = renderizarMarkdown('- [x] feito\n- [ ] a fazer');
  assert.match(html, /type="checkbox"/);
});

test('documento vazio não quebra', () => {
  assert.equal(typeof renderizarMarkdown(''), 'string');
});

// ---------------------------------------------------------------------------
// Onde o preview aparece
// ---------------------------------------------------------------------------

test('só markdown tem preview', () => {
  assert.equal(temPreview('markdown'), true);
  for (const outra of ['typescript', 'sql', 'plaintext', 'html']) {
    assert.equal(temPreview(outra), false, outra);
  }
});
