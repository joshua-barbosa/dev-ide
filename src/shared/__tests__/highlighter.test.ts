// Testes do realce de sintaxe.
//
// O tokenizador e as definições de linguagem são lógica pura, sem DOM — por
// isso vivem em `shared` e rodam aqui. Antes desta migração o realce só era
// verificável abrindo o navegador e olhando; agora tem rede de proteção.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Highlighter } from '../editor/highlighter';
import { EXT_TO_LANG, LANGUAGES } from '../editor/languages';

/** Extrai os tipos de token, que é o que determina a cor na tela. */
function tipos(codigo: string, lang: string): string[] {
  return Highlighter.tokenize(codigo, lang)
    .filter((t) => t.type !== 'ws')
    .map((t) => t.type);
}

function tokenDe(codigo: string, lang: string, texto: string): string | undefined {
  return Highlighter.tokenize(codigo, lang).find((t) => t.text === texto)?.type;
}

// ---- tokenização ----

test('reconhece palavra-chave, string, número e comentário em JavaScript', () => {
  assert.equal(tokenDe('const x = 1;', 'javascript', 'const'), 'kw');
  assert.equal(tokenDe('const s = "oi";', 'javascript', '"oi"'), 'str');
  assert.equal(tokenDe('const n = 42;', 'javascript', '42'), 'num');
  assert.equal(tokenDe('// nota\nx', 'javascript', '// nota'), 'com');
});

test('classifica identificador seguido de parêntese como função', () => {
  assert.equal(tokenDe('somar(1, 2)', 'javascript', 'somar'), 'fn');
});

test('PascalCase vira classe e UPPER_CASE vira constante', () => {
  assert.equal(tokenDe('new Calculadora()', 'javascript', 'Calculadora'), 'cls');
  assert.equal(tokenDe('const A = LIMITE_MAX;', 'javascript', 'LIMITE_MAX'), 'const');
});

test('TypeScript reconhece as palavras que o JavaScript não tem', () => {
  assert.equal(tokenDe('interface X {}', 'typescript', 'interface'), 'kw');
  assert.equal(tokenDe('const a: string = "x";', 'typescript', 'string'), 'kw');
});

test('Python reconhece def e as próprias palavras-chave', () => {
  assert.equal(tokenDe('def saudacao(n):', 'python', 'def'), 'kw');
  assert.equal(tokenDe('x = None', 'python', 'None'), 'kw');
});

// ---- SQL ----

test('SQL não diferencia maiúsculas de minúsculas', () => {
  // É a diferença estrutural do SQL: SELECT, Select e select são a mesma palavra.
  for (const palavra of ['SELECT', 'select', 'Select']) {
    assert.equal(tokenDe(`${palavra} 1`, 'sql', palavra), 'kw', palavra);
  }
  assert.equal(tokenDe('select COUNT(*)', 'sql', 'COUNT'), 'builtin');
});

test('SQL entende comentário de traço e identificador com crase', () => {
  assert.equal(tokenDe('-- nota\nselect 1', 'sql', '-- nota'), 'com');
  assert.equal(tokenDe('select * from `tabela`', 'sql', '`tabela`'), 'var');
});

test('string de SQL usa aspas simples e aceita a aspa dobrada', () => {
  assert.equal(tokenDe("where n = 'jo''shua'", 'sql', "'jo''shua'"), 'str');
});

// ---- segurança e bordas ----

test('escapa HTML, para conteúdo de arquivo não virar marcação', () => {
  // O realce injeta HTML no DOM; sem escape, um arquivo com <script> executaria.
  const saida = Highlighter.highlight('<script>alert(1)</script>', 'plain');
  assert.ok(!saida.includes('<script>'), 'a tag crua não pode sobreviver');
  assert.ok(saida.includes('&lt;script&gt;'), 'deveria estar escapada');
});

test('linguagem desconhecida cai em texto puro em vez de estourar', () => {
  assert.doesNotThrow(() => Highlighter.highlight('qualquer coisa', 'klingon'));
  assert.deepEqual(tipos('qualquer coisa', 'klingon'), ['text', 'text']);
});

test('entrada vazia devolve saída vazia', () => {
  assert.equal(Highlighter.highlight('', 'javascript'), '');
});

test('toda linguagem declarada tem regra e modo de classificação válidos', () => {
  const modos = new Set(['c-like', 'python', 'sql', 'none']);
  for (const [nome, def] of Object.entries(LANGUAGES)) {
    assert.ok(def.rules.length > 0, `${nome} sem regras`);
    assert.ok(modos.has(def.classify), `${nome} com classify inválido: ${def.classify}`);
  }
});

test('as extensões mapeiam para linguagens que existem', () => {
  for (const [ext, lang] of Object.entries(EXT_TO_LANG)) {
    assert.ok(LANGUAGES[lang] !== undefined, `${ext} aponta para "${lang}", que não existe`);
  }
  assert.equal(EXT_TO_LANG['.sql'], 'sql');
  assert.equal(EXT_TO_LANG['.ts'], 'typescript');
});
