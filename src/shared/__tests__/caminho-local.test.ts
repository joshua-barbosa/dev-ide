// Caminho de arquivo DA MÁQUINA, que no Windows é separado por `\`.
//
// O defeito que originou este módulo (D223): a interface perguntava
// `caminho.startsWith(raiz + '/')`, e no Windows a resposta era sempre não.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dentroDe, nomeDoCaminho, nomeParaExibir, pastaDoCaminho, separadorDe,
} from '../caminho-local';

test('o separador é o da plataforma', () => {
  assert.equal(separadorDe('win32'), '\\');
  assert.equal(separadorDe('linux'), '/');
  assert.equal(separadorDe('darwin'), '/');
});

test('no Windows, uma subpasta está dentro da raiz', () => {
  // A comparação que estava errada: `'C:\\proj\\src'.startsWith('C:\\proj/')`.
  assert.equal(dentroDe('C:\\proj', 'C:\\proj\\src', 'win32'), true);
  assert.equal(dentroDe('C:\\proj', 'C:\\proj\\src\\ui\\a.ts', 'win32'), true);
  assert.equal(dentroDe('C:\\proj', 'C:\\outro\\src', 'win32'), false);
});

test('no Windows a barra de Unix também separa — o Node aceita as duas', () => {
  assert.equal(dentroDe('C:/proj', 'C:/proj/src', 'win32'), true);
  assert.equal(dentroDe('C:\\proj', 'C:\\proj/src', 'win32'), true);
});

test('no Linux a contrabarra é NOME, e não separador', () => {
  assert.equal(dentroDe('/a', '/a/b', 'linux'), true);
  // Um arquivo chamado `b\c` dentro de `/a` não está dentro de `/a\b`.
  assert.equal(dentroDe('/a\\b', '/a\\b\\c', 'linux'), false);
});

test('a própria pasta não está DENTRO dela — quem pergunta trata o igual à parte', () => {
  assert.equal(dentroDe('/a', '/a', 'linux'), false);
  assert.equal(dentroDe('C:\\proj', 'C:\\proj', 'win32'), false);
});

test('prefixo de texto não é prefixo de caminho', () => {
  // `/abc` começa com `/ab`, e não está dentro dele.
  assert.equal(dentroDe('/ab', '/abc', 'linux'), false);
  assert.equal(dentroDe('C:\\pro', 'C:\\projeto', 'win32'), false);
});

test('o nome é o último pedaço, com qualquer separador', () => {
  assert.equal(nomeDoCaminho('C:\\proj\\src\\a.ts', 'win32'), 'a.ts');
  assert.equal(nomeDoCaminho('C:\\proj\\src\\', 'win32'), 'src');
  assert.equal(nomeDoCaminho('/a/b/c.ts', 'linux'), 'c.ts');
  assert.equal(nomeDoCaminho('/a/b/', 'linux'), 'b');
  // Uma raiz não tem nome acima dela: devolve ela mesma em vez de vazio.
  assert.equal(nomeDoCaminho('C:\\', 'win32'), 'C:\\');
  assert.equal(nomeDoCaminho('/', 'linux'), '/');
});

test('no Linux a contrabarra faz parte do nome', () => {
  assert.equal(nomeDoCaminho('/a/b\\c.ts', 'linux'), 'b\\c.ts');
});

test('a pasta é o que vem antes do último separador', () => {
  assert.equal(pastaDoCaminho('C:\\proj\\src\\a.ts', 'win32'), 'C:\\proj\\src');
  assert.equal(pastaDoCaminho('/a/b/c.ts', 'linux'), '/a/b');
  // Sem separador nenhum, não há pasta a informar.
  assert.equal(pastaDoCaminho('a.ts', 'linux'), '');
});

test('o nome para a tela deduz o separador do próprio caminho', () => {
  assert.equal(nomeParaExibir('C:\\proj\\src\\a.ts'), 'a.ts');
  assert.equal(nomeParaExibir('\\\\servidor\\compartilhado\\b.ts'), 'b.ts');
  assert.equal(nomeParaExibir('/home/alguem/c.ts'), 'c.ts');
  // Sem parecer Windows, a contrabarra continua sendo nome.
  assert.equal(nomeParaExibir('/home/alguem/d\\e.ts'), 'd\\e.ts');
});
