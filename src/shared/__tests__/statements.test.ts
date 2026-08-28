import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STATEMENTS, quebrarEmStatements } from '../sql/statements';

/** Só os textos, para as asserções ficarem legíveis. */
const textos = (sql: string): string[] => quebrarEmStatements(sql).statements.map((s) => s.texto);

// ---------------------------------------------------------------------------
// O básico
// ---------------------------------------------------------------------------

test('separa dois statements pelo ponto-e-vírgula', () => {
  assert.deepEqual(textos('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
});

test('o texto após o último ponto-e-vírgula também é statement', () => {
  // AC-21. Arquivo de trabalho quase nunca termina com `;`.
  assert.deepEqual(textos('SELECT 1;\nSELECT 2'), ['SELECT 1', 'SELECT 2']);
});

test('arquivo com um statement só, sem terminador', () => {
  assert.deepEqual(textos('SELECT 1'), ['SELECT 1']);
});

test('o ponto-e-vírgula terminador não vai junto', () => {
  // Alguns drivers leem `;` como pedido de múltiplos comandos.
  assert.deepEqual(textos('DELETE FROM t;'), ['DELETE FROM t']);
});

// ---------------------------------------------------------------------------
// Os nove casos que derrubam a implementação ingênua (AC-20)
// ---------------------------------------------------------------------------

test('ponto-e-vírgula dentro de aspa simples não separa', () => {
  assert.deepEqual(textos("SELECT ';'"), ["SELECT ';'"]);
});

test('aspa simples escapada por duplicação não fecha o literal', () => {
  assert.deepEqual(textos("SELECT 'it''s; ok'"), ["SELECT 'it''s; ok'"]);
});

test('aspa simples escapada por barra invertida não fecha o literal', () => {
  assert.deepEqual(textos("SELECT 'a\\'; b'"), ["SELECT 'a\\'; b'"]);
});

test('ponto-e-vírgula dentro de aspa dupla não separa', () => {
  assert.deepEqual(textos('SELECT ";"'), ['SELECT ";"']);
});

test('ponto-e-vírgula dentro de crase não separa', () => {
  // Identificador do MySQL: `a;b` é um nome de coluna válido.
  assert.deepEqual(textos('SELECT `a;b` FROM t'), ['SELECT `a;b` FROM t']);
});

test('comentário de linha com -- engole o ponto-e-vírgula', () => {
  assert.deepEqual(textos('SELECT 1 -- comenta; aqui\n'), ['SELECT 1 -- comenta; aqui']);
});

test('comentário de linha com # engole o ponto-e-vírgula', () => {
  assert.deepEqual(textos('SELECT 1 # comenta; aqui\n'), ['SELECT 1 # comenta; aqui']);
});

test('comentário de bloco engole o ponto-e-vírgula', () => {
  assert.deepEqual(textos('SELECT /* a; b */ 1'), ['SELECT /* a; b */ 1']);
});

test('bloco de dólar do PostgreSQL engole o ponto-e-vírgula', () => {
  const sql = "DO $$ BEGIN PERFORM 1; END $$;\nSELECT 2";
  assert.deepEqual(textos(sql), ['DO $$ BEGIN PERFORM 1; END $$', 'SELECT 2']);
});

test('bloco de dólar com rótulo só fecha com o mesmo rótulo', () => {
  const sql = "DO $corpo$ SELECT 1; $x$ ainda dentro $corpo$; SELECT 2";
  assert.deepEqual(textos(sql), ['DO $corpo$ SELECT 1; $x$ ainda dentro $corpo$', 'SELECT 2']);
});

test('cifrão que não abre bloco não atrapalha', () => {
  // `$1` é parâmetro no PostgreSQL, não abertura de bloco.
  assert.deepEqual(textos('SELECT $1; SELECT $2'), ['SELECT $1', 'SELECT $2']);
});

// ---------------------------------------------------------------------------
// O que NÃO vira ação (AC-22)
// ---------------------------------------------------------------------------

test('trecho vazio entre pontos-e-vírgula não vira statement', () => {
  assert.deepEqual(textos(';;;'), []);
});

test('trecho só de espaço não vira statement', () => {
  assert.deepEqual(textos('SELECT 1;\n\n   \n'), ['SELECT 1']);
});

test('trecho só de comentário não vira statement', () => {
  // Não há o que rodar num arquivo que só tem cabeçalho.
  assert.deepEqual(textos('-- só um comentário\n'), []);
  assert.deepEqual(textos('/* nada aqui */'), []);
  assert.deepEqual(textos('SELECT 1;\n-- rodapé\n'), ['SELECT 1']);
});

test('arquivo vazio não tem statement', () => {
  assert.deepEqual(textos(''), []);
  assert.deepEqual(textos('   \n  '), []);
});

// ---------------------------------------------------------------------------
// As posições — é o que põe o CodeLens no lugar certo
// ---------------------------------------------------------------------------

test('a linha de cada statement é a da primeira palavra, contando de 1', () => {
  const { statements } = quebrarEmStatements('SELECT 1;\nSELECT 2;\n\nSELECT 3');
  assert.deepEqual(statements.map((s) => s.linhaInicio), [1, 2, 4]);
});

test('o statement começa na primeira linha com conteúdo, não no espaço antes', () => {
  // O `;` anterior deixa quebra de linha e espaço para trás; o CodeLens não pode
  // aparecer sobre a linha em branco.
  const { statements } = quebrarEmStatements('SELECT 1;\n\n\n   SELECT 2');
  assert.equal(statements[1]?.linhaInicio, 4);
});

test('a linha final é a última com conteúdo do statement', () => {
  const { statements } = quebrarEmStatements('SELECT\n  1\n;\nSELECT 2');
  assert.equal(statements[0]?.linhaInicio, 1);
  assert.equal(statements[0]?.linhaFim, 2);
});

test('comentário antes do statement conta como parte dele', () => {
  // Rodar "a query com o comentário que a explica" é o que o usuário espera ao
  // clicar no Run que aparece acima do comentário.
  const { statements } = quebrarEmStatements('-- explica\nSELECT 1');
  assert.equal(statements.length, 1);
  assert.equal(statements[0]?.linhaInicio, 1);
  assert.equal(statements[0]?.texto, '-- explica\nSELECT 1');
});

test('as posições em caracteres recortam o texto original', () => {
  const sql = 'SELECT 1;\nSELECT 2';
  const { statements } = quebrarEmStatements(sql);
  for (const s of statements) {
    assert.equal(sql.slice(s.inicio, s.fim), s.texto);
  }
});

// ---------------------------------------------------------------------------
// O teto (AC-23)
// ---------------------------------------------------------------------------

test('para no teto de statements e avisa que parou', () => {
  const sql = 'SELECT 1;\n'.repeat(MAX_STATEMENTS + 10);
  const r = quebrarEmStatements(sql);
  assert.equal(r.statements.length, MAX_STATEMENTS);
  assert.equal(r.truncado, true);
});

test('abaixo do teto não avisa nada', () => {
  const r = quebrarEmStatements('SELECT 1;\nSELECT 2');
  assert.equal(r.truncado, false);
});

// ---------------------------------------------------------------------------
// Literal ou comentário sem fechar: não pode engolir o arquivo em silêncio
// ---------------------------------------------------------------------------

test('aspa que não fecha vira um statement só, até o fim', () => {
  // Está errado de qualquer jeito; o certo é mandar para o banco e deixar ELE
  // dizer que a sintaxe está errada, em vez de a IDE adivinhar onde fechar.
  assert.deepEqual(textos("SELECT 'sem fim; SELECT 2"), ["SELECT 'sem fim; SELECT 2"]);
});

test('comentário de bloco que não fecha engole o resto', () => {
  assert.deepEqual(textos('SELECT 1 /* sem fim; SELECT 2'), ['SELECT 1 /* sem fim; SELECT 2']);
});

// ---------------------------------------------------------------------------
// Corpo de rotina: BEGIN…END (T052, spec 071)
// ---------------------------------------------------------------------------
//
// A nota dele na triagem: *"Só entender BEGIN…END, sem DELIMITER. Não é
// conveniência: hoje o quebrador parte DENTRO do corpo e manda meia query,
// calado."* É o pior tipo de defeito desta peça — partir no `;` errado não dá
// erro de sintaxe, dá meia query.

test('o `;` DENTRO de um corpo de procedure não parte o statement', () => {
  const { statements } = quebrarEmStatements(
    'CREATE PROCEDURE p(IN n INT)\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND;\nSELECT 3;\n'
  );
  assert.equal(statements.length, 2);
  assert.match(statements[0]?.texto ?? '', /^CREATE PROCEDURE/);
  assert.match(statements[0]?.texto ?? '', /SELECT 2;\s*END$/);
  assert.equal(statements[1]?.texto, 'SELECT 3');
});

test('`BEGIN` de TRANSAÇÃO continua sendo statement solto', () => {
  // Se `BEGIN` abrisse bloco sempre, um `BEGIN;` engoliria o arquivo inteiro.
  const { statements } = quebrarEmStatements('BEGIN;\nUPDATE t SET a = 1;\nCOMMIT;\n');
  assert.deepEqual(
    statements.map((s) => s.texto),
    ['BEGIN', 'UPDATE t SET a = 1', 'COMMIT']
  );
});

test('blocos aninhados: só o END de fora fecha', () => {
  const { statements } = quebrarEmStatements(
    'CREATE FUNCTION f() RETURNS INT\nBEGIN\n  BEGIN\n    SELECT 1;\n  END;\n  RETURN 2;\nEND;\nSELECT 9;\n'
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[1]?.texto, 'SELECT 9');
});

test('`END IF` e `END LOOP` NÃO fecham o corpo', () => {
  const { statements } = quebrarEmStatements(
    'CREATE PROCEDURE p()\nBEGIN\n  IF 1 = 1 THEN\n    SELECT 1;\n  END IF;\n' +
      '  loop1: LOOP\n    SELECT 2;\n    LEAVE loop1;\n  END LOOP;\nEND;\nSELECT 9;\n'
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[1]?.texto, 'SELECT 9');
});

test('`CASE … END` como EXPRESSÃO não desequilibra a conta', () => {
  // O `END` da expressão é o mesmo do bloco; sem contar o `CASE` que o abriu, o
  // corpo fecharia cedo demais e o `;` seguinte partiria no meio.
  const { statements } = quebrarEmStatements(
    'CREATE PROCEDURE p()\nBEGIN\n  SELECT CASE WHEN 1 THEN 2 ELSE 3 END;\n  SELECT 4;\nEND;\nSELECT 9;\n'
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[1]?.texto, 'SELECT 9');
});

test('`CASE … END CASE` como COMANDO também fecha certo', () => {
  const { statements } = quebrarEmStatements(
    'CREATE PROCEDURE p()\nBEGIN\n  CASE 1 WHEN 1 THEN SELECT 1; ELSE SELECT 2; END CASE;\nEND;\nSELECT 9;\n'
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[1]?.texto, 'SELECT 9');
});

test('gatilho SEM corpo composto continua partindo no `;`', () => {
  const { statements } = quebrarEmStatements(
    "CREATE TRIGGER tg BEFORE INSERT ON t FOR EACH ROW SET NEW.n = TRIM(NEW.n);\nSELECT 9;\n"
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[1]?.texto, 'SELECT 9');
});

test('a palavra `begin` dentro de literal ou nome não abre bloco', () => {
  const { statements } = quebrarEmStatements(
    "SELECT 'begin';\nSELECT `end`;\nSELECT beginner FROM t;\n"
  );
  assert.equal(statements.length, 3);
});

test('`DEFINER` antes do tipo da rotina não atrapalha', () => {
  const { statements } = quebrarEmStatements(
    "CREATE DEFINER=`app`@`%` PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND;\nSELECT 9;\n"
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[1]?.texto, 'SELECT 9');
});

test('corpo aberto e nunca fechado vira UM statement, e não some', () => {
  // Arquivo em edição: melhor um statement grande que o usuário vê do que
  // pedaços que ele não escreveu.
  const { statements } = quebrarEmStatements('CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n');
  assert.equal(statements.length, 1);
  assert.match(statements[0]?.texto ?? '', /^CREATE PROCEDURE/);
});
