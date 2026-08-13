import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectStore } from '../projects';

function tempStore(): ProjectStore {
  return new ProjectStore(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-test-')));
}

test('cria e lista projetos', () => {
  const store = tempStore();
  assert.deepEqual(store.listProjects(), []);
  store.createProject('meu-projeto');
  store.createProject('outro projeto');
  assert.deepEqual(store.listProjects(), ['meu-projeto', 'outro projeto']);
});

test('rejeita nome de projeto inválido', () => {
  const store = tempStore();
  assert.throws(() => store.createProject('../fuga'), /inválido/);
  assert.throws(() => store.createProject(''), /inválido/);
});

test('rejeita projeto duplicado', () => {
  const store = tempStore();
  store.createProject('dup');
  assert.throws(() => store.createProject('dup'), /já existe/);
});

test('monta árvore de arquivos ignorando node_modules e ocultos', () => {
  const store = tempStore();
  const dir = store.createProject('p1');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export {}');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'export {}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.oculto'), 'x');

  const tree = store.fileTree('p1');
  assert.deepEqual(
    tree.map((n) => `${n.type}:${n.name}`),
    ['dir:src', 'file:a.ts']
  );
  assert.deepEqual(tree[0].children?.map((n) => n.name), ['b.ts']);
});

test('projectFiles filtra por extensão', () => {
  const store = tempStore();
  const dir = store.createProject('p2');
  fs.writeFileSync(path.join(dir, 'a.ts'), '');
  fs.writeFileSync(path.join(dir, 'b.md'), '');
  const files = store.projectFiles('p2', new Set(['.ts']));
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('a.ts'));
});

test('bloqueia path traversal em projectDir', () => {
  const store = tempStore();
  assert.throws(() => store.projectDir('../../etc'));
});
