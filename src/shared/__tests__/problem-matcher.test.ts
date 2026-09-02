// Da saída do comando para a aba Problems (T008).
//
// Cada bloco abaixo é a saída REAL de uma ferramenta, copiada da forma como ela
// escreve. Inventar o formato aqui provaria que o regex casa com o que eu
// mesmo escrevi.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerSaida } from '../problem-matcher';

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
