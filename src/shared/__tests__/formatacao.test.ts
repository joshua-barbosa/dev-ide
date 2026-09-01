// Beautify e Minify: a declaração e o colapso de SQL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPACIDADES, capacidadeDe, podeFormatar, sqlNumaLinha } from '../formatacao';
import { EXT_TO_LANG, NOME_TO_LANG } from '../editor/languages';

test('toda linguagem declarada é uma linguagem que a IDE abre', () => {
  const conhecidas = new Set([...Object.values(EXT_TO_LANG), ...Object.values(NOME_TO_LANG)]);
  for (const linguagem of Object.keys(CAPACIDADES)) {
    assert.ok(conhecidas.has(linguagem), `"${linguagem}" não é linguagem desta IDE`);
  }
});

test('o que NÃO pode sempre diz por quê, no modo certo', () => {
  for (const [linguagem, c] of Object.entries(CAPACIDADES)) {
    for (const modo of ['beautify', 'minify'] as const) {
      if (c[modo]) continue;
      assert.ok(
        (c.porQueNao[modo] ?? '').length > 20,
        `"${linguagem}" recusa o ${modo} sem explicar`
      );
    }
  }
});

test('linguagem desconhecida não pode nada, e diz qual é', () => {
  const c = capacidadeDe('cobol');
  assert.equal(c.beautify, false);
  assert.equal(c.minify, false);
  assert.match(c.porQueNao.beautify ?? '', /cobol/);
  assert.match(c.porQueNao.minify ?? '', /cobol/);
});

test('Python só formata quando a máquina tem a ferramenta', () => {
  const sem = capacidadeDe('python', { formatadorDePython: null });
  assert.equal(sem.beautify, false, 'sem ruff nem black, não promete o que não faz');
  assert.equal(sem.instalar, 'pip install ruff', 'e diz o que instalar');

  const com = capacidadeDe('python', { formatadorDePython: '/usr/bin/ruff' });
  assert.equal(com.beautify, true);
  assert.equal(com.minify, false, 'a indentação é a sintaxe, com ou sem ruff');
});

test('a ferramenta de Python não muda mais nada', () => {
  const js = capacidadeDe('javascript', { formatadorDePython: '/usr/bin/ruff' });
  assert.deepEqual(js, CAPACIDADES.javascript);
});

test('podeFormatar devolve o motivo pronto, com o que instalar junto', () => {
  const r = podeFormatar(capacidadeDe('python'), 'beautify');
  assert.equal(r.pode, false);
  assert.match(r.pode === false ? r.motivo : '', /ruff/);
  assert.match(r.pode === false ? r.motivo : '', /pip install ruff/);

  assert.equal(podeFormatar(capacidadeDe('javascript'), 'minify').pode, true);
});

test('cada modo recusa pelo SEU motivo — o do Python é o caso', () => {
  // Sem ferramenta na máquina os dois modos caem, e por razões diferentes.
  // Um motivo compartilhado mandaria instalar o ruff para quem tentou
  // minificar, e o ruff não resolve isso.
  const c = capacidadeDe('python', { formatadorDePython: null });
  const b = podeFormatar(c, 'beautify');
  const m = podeFormatar(c, 'minify');
  assert.match(b.pode === false ? b.motivo : '', /ruff/);
  assert.match(m.pode === false ? m.motivo : '', /sintaxe/);
  assert.equal(/ruff/.test(m.pode === false ? m.motivo : ''), false);
});

test('TypeScript formata mas não minifica, e o motivo fala de tipos', () => {
  const c = capacidadeDe('typescript');
  assert.equal(c.beautify, true);
  assert.equal(c.minify, false);
  assert.match(c.porQueNao.minify ?? '', /tipos/);
});

// ---------------------------------------------------------------------------
// O colapso de SQL
// ---------------------------------------------------------------------------

test('junta as linhas numa só', () => {
  assert.equal(
    sqlNumaLinha('SELECT a,\n       b\n  FROM t\n WHERE x = 1'),
    'SELECT a, b FROM t WHERE x = 1'
  );
});

test('espaço DENTRO de texto é dado, e não encolhe', () => {
  assert.equal(
    sqlNumaLinha("SELECT   'a    b'   FROM t"),
    "SELECT 'a    b' FROM t"
  );
});

test('a quebra de linha dentro de um texto sobrevive', () => {
  assert.equal(sqlNumaLinha("SELECT 'a\nb'"), "SELECT 'a\nb'");
});

test("'' dentro do texto não fecha o texto", () => {
  assert.equal(sqlNumaLinha("SELECT 'ele''s   x'  FROM t"), "SELECT 'ele''s   x' FROM t");
});

test('identificador com aspas duplas e com crase fica intacto', () => {
  assert.equal(sqlNumaLinha('SELECT "co  l"\nFROM t'), 'SELECT "co  l" FROM t');
  assert.equal(sqlNumaLinha('SELECT `co  l`\nFROM t'), 'SELECT `co  l` FROM t');
});

test('comentário de linha SOME — numa linha só ele apagaria o resto', () => {
  assert.equal(
    sqlNumaLinha('SELECT a -- a coluna\nFROM t'),
    'SELECT a FROM t'
  );
});

test('comentário de bloco fica, encolhido', () => {
  assert.equal(
    sqlNumaLinha('SELECT /* duas\n   linhas */ a FROM t'),
    'SELECT /* duas linhas */ a FROM t'
  );
});

test('não sobra espaço no começo nem no fim', () => {
  assert.equal(sqlNumaLinha('\n\n  SELECT 1  \n\n'), 'SELECT 1');
});

test('texto sem fechar não entra em laço infinito', () => {
  assert.equal(sqlNumaLinha("SELECT 'sem fim"), "SELECT 'sem fim");
});

test('vazio continua vazio', () => {
  assert.equal(sqlNumaLinha('   \n  '), '');
});
