import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aspasDeShell } from '../remoto/shell';

test('caminho comum vira o mesmo caminho, entre aspas', () => {
  assert.equal(aspasDeShell('/opt/run.sh'), "'/opt/run.sh'");
});

test('espaço não vira dois argumentos', () => {
  assert.equal(aspasDeShell('/opt/meu script.sh'), "'/opt/meu script.sh'");
});

test('o que o shell interpretaria vira TEXTO', () => {
  // Cada um destes é uma forma de rodar outra coisa. Dentro de aspas simples,
  // todos são só letras.
  for (const perigoso of [
    '/tmp/a;rm -rf /',
    '/tmp/$(whoami)',
    '/tmp/`id`',
    '/tmp/a && curl x',
    '/tmp/a|b',
    '/tmp/$HOME',
    '/tmp/a\nb',
  ]) {
    const citado = aspasDeShell(perigoso);
    assert.equal(citado.startsWith("'"), true, perigoso);
    assert.equal(citado.endsWith("'"), true, perigoso);
    // O conteúdo continua inteiro: citar não pode comer caractere.
    assert.equal(citado.slice(1, -1), perigoso, perigoso);
  }
});

test('a aspa simples no nome é o único caso difícil, e ele fecha', () => {
  // Dentro de aspas simples não existe escape: a única saída é fechar, escapar
  // uma aspa e reabrir.
  assert.equal(aspasDeShell("/tmp/it's.sh"), `'/tmp/it'\\''s.sh'`);
  // E o resultado, lido por um shell, tem que voltar a ser o original.
  const citado = aspasDeShell("a'b'c");
  assert.equal(citado, `'a'\\''b'\\''c'`);
});

test('vazio continua sendo um argumento, e não some', () => {
  assert.equal(aspasDeShell(''), "''");
});
