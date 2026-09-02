// Da saída do comando para a aba Problems (T008).
//
// Cada bloco abaixo é a saída REAL de uma ferramenta, copiada da forma como ela
// escreve. Inventar o formato aqui provaria que o regex casa com o que eu
// mesmo escrevi.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerSaida, semCores } from '../problem-matcher';

const RAIZ = '/casa/projeto';

test('tsc: arquivo, linha, coluna, código e mensagem', () => {
  const [p] = lerSaida(
    "src/a.ts(12,5): error TS2304: Cannot find name 'x'.",
    RAIZ
  );
  assert.equal(p?.caminho, '/casa/projeto/src/a.ts');
  assert.equal(p?.linha, 12);
  assert.equal(p?.coluna, 5);
  assert.equal(p?.severidade, 'erro');
  assert.equal(p?.codigo, 'TS2304');
  assert.match(p?.mensagem ?? '', /Cannot find name/);
});

test('gcc e afins: `arquivo:linha:coluna: error: mensagem`', () => {
  const [p] = lerSaida('src/main.c:42:9: error: expected ";" before "}"', RAIZ);
  assert.equal(p?.caminho, '/casa/projeto/src/main.c');
  assert.equal(p?.linha, 42);
  assert.equal(p?.coluna, 9);
  assert.equal(p?.severidade, 'erro');
});

test('aviso é aviso, e não erro', () => {
  const [p] = lerSaida('src/a.js:3:1: warning: unused variable', RAIZ);
  assert.equal(p?.severidade, 'aviso');
});

test('PHP: o caminho vem no FIM da linha', () => {
  const [p] = lerSaida(
    'PHP Parse error:  syntax error, unexpected ";" in /var/www/site/index.php on line 88',
    RAIZ
  );
  assert.equal(p?.caminho, '/var/www/site/index.php');
  assert.equal(p?.linha, 88);
  assert.equal(p?.severidade, 'erro');
});

test('PHP Warning não vira erro', () => {
  const [p] = lerSaida(
    'PHP Warning:  Undefined variable $x in /var/www/a.php on line 3',
    RAIZ
  );
  assert.equal(p?.severidade, 'aviso');
});

test('Python: a mensagem vem do FIM do traceback', () => {
  // O `File "..."` diz o LUGAR; o `ValueError` diz o QUÊ, e ele está lá
  // embaixo. Sem juntar os dois, a aba mostraria um problema sem mensagem.
  const saida = [
    'Traceback (most recent call last):',
    '  File "app.py", line 12, in <module>',
    '    processar()',
    '  File "app.py", line 5, in processar',
    '    raise ValueError("faltou o arquivo")',
    'ValueError: faltou o arquivo',
  ].join('\n');
  const achados = lerSaida(saida, RAIZ);
  assert.equal(achados.length, 2, 'as duas linhas do traceback');
  assert.equal(achados[0]?.caminho, '/casa/projeto/app.py');
  assert.equal(achados[0]?.linha, 12);
  assert.match(achados[0]?.mensagem ?? '', /ValueError: faltou o arquivo/);
});

test('ruff e flake8: o código é o `E501`', () => {
  const [p] = lerSaida('app.py:7:80: E501 line too long (99 > 88)', RAIZ);
  assert.equal(p?.linha, 7);
  assert.equal(p?.coluna, 80);
  assert.equal(p?.codigo, 'E501');
});

test('linha de saída COMUM não vira problema', () => {
  // Encher a aba de ruído é o mesmo que não ter a aba: ninguém olha mais.
  const saida = [
    '> meu-projeto@1.0.0 build',
    '> tsc -p .',
    '',
    'Compilado em 3.2s',
    'Servindo em http://localhost:3000',
  ].join('\n');
  assert.deepEqual(lerSaida(saida, RAIZ), []);
});

test('caminho ABSOLUTO na saída fica como está', () => {
  const [p] = lerSaida('/outro/lugar/x.ts(1,1): error TS1005: falta algo', RAIZ);
  assert.equal(p?.caminho, '/outro/lugar/x.ts');
});

test('`./` no começo do caminho não vira `//`', () => {
  const [p] = lerSaida('./src/a.ts(1,1): error TS1005: falta', RAIZ);
  assert.equal(p?.caminho, '/casa/projeto/src/a.ts');
});

test('o mesmo erro duas vezes vira UM problema', () => {
  // Um `tsc --watch` reimprime o mesmo erro a cada ciclo.
  const linha = "src/a.ts(12,5): error TS2304: Cannot find name 'x'.";
  assert.equal(lerSaida(`${linha}\n${linha}\n${linha}`, RAIZ).length, 1);
});

test('a mesma linha não casa em dois padrões', () => {
  // Sem o corte, `a.ts:1:1: error: x` casaria em `gnu` e no genérico, e o
  // problema apareceria duas vezes.
  const achados = lerSaida('src/a.ts:1:1: error: alguma coisa', RAIZ);
  assert.equal(achados.length, 1);
});

test('sem severidade declarada, é ERRO', () => {
  // Uma ferramenta que não diz costuma estar reclamando de algo; chamar de
  // nota esconderia o problema no meio da lista.
  const [p] = lerSaida('src/a.ts:9:2: alguma coisa quebrou', RAIZ);
  assert.equal(p?.severidade, 'erro');
});

test('saída vazia devolve lista vazia', () => {
  assert.deepEqual(lerSaida('', RAIZ), []);
});

// ---------------------------------------------------------------------------
// O que a saída REAL desta máquina tem, e o teste inventado não tinha
// ---------------------------------------------------------------------------

test('traceback COLORIDO do Python 3.13 é lido', () => {
  // Medido na saída desta máquina: o Python 3.13 colore o traceback, e o `"`
  // deixa de vir logo depois de `File `. Sem tirar as cores, NENHUM erro de
  // Python chegava à aba Problems.
  const colorido =
    'Traceback (most recent call last):\n' +
    '  File \u001b[35m"/tmp/x.py"\u001b[0m, line \u001b[35m2\u001b[0m, in \u001b[35m<module>\u001b[0m\n' +
    '    raise ValueError("estourou")\n' +
    '\u001b[1;35mValueError\u001b[0m: \u001b[35mestourou\u001b[0m\n';

  const achados = lerSaida(colorido, '/casa');
  assert.equal(achados.length, 1);
  assert.equal(achados[0]?.linha, 2);
  assert.equal(achados[0]?.mensagem, 'ValueError: estourou');
});

test('semCores não come texto de verdade', () => {
  assert.equal(semCores('sem cor nenhuma'), 'sem cor nenhuma');
  assert.equal(semCores('a\u001b[31mb\u001b[0mc'), 'abc');
});

test('a cópia temporária da execução vira o arquivo de verdade', () => {
  // A execução copia o código para `/tmp/dev-ide-run-XXXX/main.py` e roda de
  // lá. Sem traduzir, clicar no problema abriria um arquivo já apagado.
  const saida =
    'Traceback (most recent call last):\n' +
    '  File "/tmp/dev-ide-run-Ga5k6d/main.py", line 2, in <module>\n' +
    'ValueError: estourou\n';

  const [achado] = lerSaida(saida, '/casa', '/casa/projeto/script.py');
  assert.equal(achado?.caminho, '/casa/projeto/script.py');
});

test('sem o arquivo real, a cópia continua como está — sem inventar', () => {
  const saida = '  File "/tmp/dev-ide-run-Ga5k6d/main.py", line 2, in <module>\nValueError: x\n';
  assert.equal(lerSaida(saida, '/casa')[0]?.caminho, '/tmp/dev-ide-run-Ga5k6d/main.py');
});

test('só a CÓPIA é traduzida: a biblioteca do sistema no traceback fica', () => {
  const saida =
    'Traceback (most recent call last):\n' +
    '  File "/usr/lib/python3.13/json/decoder.py", line 355, in raw_decode\n' +
    'JSONDecodeError: Expecting value\n';

  const [achado] = lerSaida(saida, '/casa', '/casa/projeto/script.py');
  assert.equal(achado?.caminho, '/usr/lib/python3.13/json/decoder.py');
});
