// O `tasks.json` (T015, T016).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerTarefas, planoDe, tarefaPadrao } from '../tarefas';

const arquivo = (...tasks: unknown[]) => ({ version: '2.0.0', tasks });

test('lê o essencial de uma tarefa', () => {
  const [t] = lerTarefas(arquivo({
    label: 'build',
    type: 'shell',
    command: 'npm',
    args: ['run', 'build'],
    options: { cwd: 'app' },
    group: { kind: 'build', isDefault: true },
  }));
  assert.equal(t?.nome, 'build');
  assert.equal(t?.comando, 'npm run build', 'os args entram na linha de comando');
  assert.equal(t?.cwd, 'app');
  assert.equal(t?.grupo, 'build');
  assert.equal(t?.padraoDoGrupo, true);
});

test('`group` como texto também vale', () => {
  const [t] = lerTarefas(arquivo({ label: 't', command: 'x', group: 'test' }));
  assert.equal(t?.grupo, 'test');
  assert.equal(t?.padraoDoGrupo, false);
});

test('tarefa sem label ou sem command é DESCARTADA', () => {
  // Inventar um nome poria na lista algo que ninguém sabe o que roda.
  const r = lerTarefas(arquivo(
    { command: 'x' },
    { label: 'sem comando' },
    { label: '  ', command: 'x' },
    { label: 'boa', command: 'x' }
  ));
  assert.deepEqual(r.map((t) => t.nome), ['boa']);
});

test('label repetido fica com a primeira — é a que o dependsOn acha', () => {
  const r = lerTarefas(arquivo({ label: 'x', command: 'um' }, { label: 'x', command: 'dois' }));
  assert.equal(r.length, 1);
  assert.equal(r[0]?.comando, 'um');
});

test('arquivo estragado devolve lista vazia, e não erro', () => {
  for (const bruto of [null, 7, 'x', [], {}, { tasks: 'nada' }, { tasks: [1, null] }]) {
    assert.deepEqual(lerTarefas(bruto), []);
  }
});

test('chave que a IDE não entende não impede a tarefa de existir', () => {
  // Um `tasks.json` de verdade vem cheio de `presentation`, `problemMatcher`,
  // `runOptions`. Recusar o arquivo por causa delas seria trocar "funciona em
  // parte" por "não funciona".
  const [t] = lerTarefas(arquivo({
    label: 'build', command: 'make',
    presentation: { reveal: 'always' },
    problemMatcher: ['$tsc'],
    runOptions: { runOn: 'folderOpen' },
  }));
  assert.equal(t?.nome, 'build');
  assert.equal(t?.comando, 'make');
});

// ---- o padrão do grupo (T016) ----

test('a marcada como padrão é a do Run Build Task', () => {
  const ts = lerTarefas(arquivo(
    { label: 'a', command: 'x', group: 'build' },
    { label: 'b', command: 'y', group: { kind: 'build', isDefault: true } }
  ));
  assert.equal(tarefaPadrao(ts, 'build')?.nome, 'b');
});

test('sem ninguém marcado, UMA só do grupo é a padrão', () => {
  const ts = lerTarefas(arquivo({ label: 'a', command: 'x', group: 'build' }));
  assert.equal(tarefaPadrao(ts, 'build')?.nome, 'a');
});

test('duas sem marca devolvem null — quem chama PERGUNTA', () => {
  const ts = lerTarefas(arquivo(
    { label: 'a', command: 'x', group: 'build' },
    { label: 'b', command: 'y', group: 'build' }
  ));
  assert.equal(tarefaPadrao(ts, 'build'), null);
  assert.equal(tarefaPadrao(ts, 'test'), null, 'grupo sem tarefa nenhuma');
});

// ---- tarefas compostas ----

const COMPOSTAS = lerTarefas(arquivo(
  { label: 'limpar', command: 'rm -rf dist' },
  { label: 'compilar', command: 'tsc', dependsOn: 'limpar' },
  { label: 'css', command: 'sass' },
  { label: 'tudo', command: 'echo ok', dependsOn: ['compilar', 'css'] },
  { label: 'em-ordem', command: 'echo fim', dependsOn: ['compilar', 'css'], dependsOrder: 'sequence' }
));

test('sem dependência, o plano é um passo só', () => {
  assert.deepEqual(
    planoDe(COMPOSTAS, 'limpar').passos.map((p) => p.map((t) => t.nome)),
    [['limpar']]
  );
});

test('a dependência roda ANTES', () => {
  assert.deepEqual(
    planoDe(COMPOSTAS, 'compilar').passos.map((p) => p.map((t) => t.nome)),
    [['limpar'], ['compilar']]
  );
});

test('em paralelo, o que pode ir junto vai junto', () => {
  // `compilar` ainda precisa de `limpar` antes; o que sobra entra num passo só.
  assert.deepEqual(
    planoDe(COMPOSTAS, 'tudo').passos.map((p) => p.map((t) => t.nome)),
    [['limpar'], ['compilar', 'css'], ['tudo']]
  );
});

test('em sequência, cada dependência é um passo', () => {
  assert.deepEqual(
    planoDe(COMPOSTAS, 'em-ordem').passos.map((p) => p.map((t) => t.nome)),
    [['limpar'], ['compilar'], ['css'], ['em-ordem']]
  );
});

test('ciclo é erro, e diz QUAIS', () => {
  const ts = lerTarefas(arquivo(
    { label: 'a', command: 'x', dependsOn: 'b' },
    { label: 'b', command: 'y', dependsOn: 'a' }
  ));
  assert.throws(() => planoDe(ts, 'a'), /círculo: a → b → a/);
});

test('dependência que não existe é erro, e não silêncio', () => {
  // Silenciar transformaria um `label` digitado errado em "a tarefa rodou sem o
  // build antes", que é o pior desfecho.
  const ts = lerTarefas(arquivo({ label: 'a', command: 'x', dependsOn: 'fantasma' }));
  assert.throws(() => planoDe(ts, 'a'), /"a" depende de "fantasma"/);
});

test('rodar tarefa que não existe é erro', () => {
  assert.throws(() => planoDe(COMPOSTAS, 'nao-existe'), /não existe/);
});

test('a mesma dependência em dois ramos roda UMA vez', () => {
  const ts = lerTarefas(arquivo(
    { label: 'base', command: 'x' },
    { label: 'a', command: 'y', dependsOn: 'base' },
    { label: 'b', command: 'z', dependsOn: 'base' },
    { label: 'fim', command: 'w', dependsOn: ['a', 'b'] }
  ));
  const nomes = planoDe(ts, 'fim').passos.flat().map((t) => t.nome);
  assert.equal(nomes.filter((n) => n === 'base').length, 1);
  assert.ok(nomes.indexOf('base') < nomes.indexOf('a'));
});

test('a tarefa de FUNDO é reconhecida', () => {
  const [t] = lerTarefas(arquivo({ label: 'watch', command: 'tsc -w', isBackground: true }));
  assert.equal(t?.deFundo, true);
});
