// Qual Python o notebook usa (spec 112, etapa 2).
//
// Ele: *"o 'kernel' pode ser da onde vem os pacotes… e onde está o python
// (tipo o .venv)"*. A plataforma vem por ARGUMENTO — Windows é uso real, e um
// padrão POSIX calado é como ele quebra lá.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidatosDePython } from '../notebook/ambiente';

const existe = (lista: string[]) => (p: string) => lista.includes(p);

test('.venv na pasta do notebook vem primeiro', () => {
  const c = candidatosDePython('/proj/analises', '/proj', 'linux',
    existe(['/proj/analises/.venv/bin/python', '/proj/.venv/bin/python']));
  assert.equal(c[0].caminho, '/proj/analises/.venv/bin/python');
  assert.equal(c[0].origem, 'venv');
});

test('sobe até a raiz do projeto procurando', () => {
  const c = candidatosDePython('/proj/a/b', '/proj', 'linux', existe(['/proj/.venv/bin/python']));
  assert.equal(c[0].caminho, '/proj/.venv/bin/python');
});

test('não sobe ACIMA da raiz do projeto', () => {
  // Um `.venv` na casa dele não é deste projeto.
  const c = candidatosDePython('/casa/proj/a', '/casa/proj', 'linux', existe(['/casa/.venv/bin/python']));
  assert.equal(c.find((i) => i.origem === 'venv'), undefined);
});

test('`venv` sem ponto também vale', () => {
  const c = candidatosDePython('/proj', '/proj', 'linux', existe(['/proj/venv/bin/python']));
  assert.equal(c[0].caminho, '/proj/venv/bin/python');
});

test('sem venv, o do sistema', () => {
  const c = candidatosDePython('/proj', '/proj', 'linux', existe([]));
  assert.deepEqual(c.map((i) => [i.caminho, i.origem]), [['python3', 'sistema']]);
});

test('no Windows: Scripts\\python.exe e `python` do sistema', () => {
  const c = candidatosDePython('C:\\proj\\notas', 'C:\\proj', 'win32',
    existe(['C:\\proj\\.venv\\Scripts\\python.exe']));
  assert.equal(c[0].caminho, 'C:\\proj\\.venv\\Scripts\\python.exe');
  assert.equal(c[c.length - 1].caminho, 'python');
});

test('o rótulo diz de onde veio, relativo ao projeto', () => {
  const c = candidatosDePython('/proj/a', '/proj', 'linux', existe(['/proj/.venv/bin/python']));
  assert.equal(c[0].rotulo, '.venv (projeto)');
  const d = candidatosDePython('/proj/a', '/proj', 'linux', existe(['/proj/a/.venv/bin/python']));
  assert.equal(d[0].rotulo, 'a/.venv');
});

test('sem projeto aberto, procura só na pasta do notebook', () => {
  const c = candidatosDePython('/tmp/x', null, 'linux', existe(['/tmp/.venv/bin/python']));
  assert.equal(c.find((i) => i.origem === 'venv'), undefined);
});
