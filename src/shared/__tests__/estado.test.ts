import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirPasta, acrescentarPasta, esquecerPasta, ESTADO_VAZIO, fecharPasta, MAX_RECENTES,
  normalizarEstado, pastaPrincipal, removerPasta,
} from '../estado';

test('estado vazio é o padrão de tudo que não dá para ler', () => {
  for (const entrada of [undefined, null, 42, 'x', [], ['a']]) {
    assert.deepEqual(normalizarEstado(entrada), ESTADO_VAZIO);
  }
});

test('a IDE nasce sem pasta, e não escolhendo uma por conta própria', () => {
  assert.deepEqual(ESTADO_VAZIO.pastas, []);
  assert.equal(pastaPrincipal(ESTADO_VAZIO), null);
  assert.deepEqual(ESTADO_VAZIO.recentes, []);
});

test('normalizar descarta entrada que não é texto', () => {
  const e = normalizarEstado({ pastas: [7, null, ''], recentes: ['/a', 3, null, '', '/b'] });
  assert.deepEqual(e.pastas, []);
  assert.deepEqual(e.recentes, ['/a', '/b']);
});

test('as pastas abertas sempre aparecem nos recentes, mesmo sem estarem listadas', () => {
  const e = normalizarEstado({ pastas: ['/atual'], recentes: ['/outra'] });
  assert.deepEqual(e.recentes, ['/atual', '/outra']);
});

test('o formato ANTIGO (`pastaAtual`) ainda abre na pasta certa (T004)', () => {
  // `state.json` gravado antes do multi-root. Sem esta migração, a primeira
  // subida depois da atualização abriria sem projeto nenhum.
  const e = normalizarEstado({ pastaAtual: '/velho', recentes: ['/velho', '/outro'] });
  assert.deepEqual(e.pastas, ['/velho']);
  assert.deepEqual(e.recentes, ['/velho', '/outro']);
});

test('pasta repetida entre os dois formatos entra uma vez só', () => {
  const e = normalizarEstado({ pastas: ['/a'], pastaAtual: '/a' });
  assert.deepEqual(e.pastas, ['/a']);
});

test('abrir SUBSTITUI: `Open Folder…` é trocar de projeto', () => {
  const e = abrirPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b');
  assert.deepEqual(e.pastas, ['/b']);
  assert.deepEqual(e.recentes, ['/b', '/a']);
});

// ---- mais de uma raiz (T004) ----

test('acrescentar soma sem tirar o que já estava', () => {
  const e = acrescentarPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b');
  assert.deepEqual(e.pastas, ['/a', '/b'], 'a ordem é a de entrada');
  assert.deepEqual(e.recentes, ['/b', '/a']);
});

test('acrescentar a mesma pasta duas vezes não duplica', () => {
  const e = acrescentarPasta(acrescentarPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b'), '/b');
  assert.deepEqual(e.pastas, ['/a', '/b']);
});

test('remover tira UMA raiz e deixa as outras', () => {
  let e = abrirPasta(ESTADO_VAZIO, '/a');
  e = acrescentarPasta(e, '/b');
  e = acrescentarPasta(e, '/c');
  assert.deepEqual(removerPasta(e, '/b').pastas, ['/a', '/c']);
  // Sai do espaço, fica no histórico: reabrir tem que continuar sendo um clique.
  assert.ok(removerPasta(e, '/b').recentes.includes('/b'));
});

test('remover o que não está aberto não muda nada', () => {
  const e = abrirPasta(ESTADO_VAZIO, '/a');
  assert.equal(removerPasta(e, '/z'), e);
});

test('a principal é a primeira, e some quando ela sai', () => {
  let e = acrescentarPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b');
  assert.equal(pastaPrincipal(e), '/a');
  e = removerPasta(e, '/a');
  assert.equal(pastaPrincipal(e), '/b');
});

test('reabrir uma pasta a move para o topo em vez de duplicar', () => {
  let e = ESTADO_VAZIO;
  for (const p of ['/a', '/b', '/c', '/a']) e = abrirPasta(e, p);
  assert.deepEqual(e.recentes, ['/a', '/c', '/b']);
});

test('a lista de recentes para de crescer', () => {
  let e = ESTADO_VAZIO;
  for (let i = 0; i < MAX_RECENTES + 5; i += 1) e = abrirPasta(e, `/pasta-${i}`);
  assert.equal(e.recentes.length, MAX_RECENTES);
  assert.equal(e.recentes[0], `/pasta-${MAX_RECENTES + 4}`, 'a mais nova fica no topo');
});

test('abrir não muta o estado anterior', () => {
  const antes = abrirPasta(ESTADO_VAZIO, '/a');
  abrirPasta(antes, '/b');
  assert.deepEqual(antes.recentes, ['/a']);
  assert.deepEqual(antes.pastas, ['/a']);
});

test('fechar preserva o histórico', () => {
  const e = fecharPasta(acrescentarPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b'));
  assert.deepEqual(e.pastas, [], 'fecha TODAS');
  assert.deepEqual(e.recentes, ['/b', '/a']);
});

test('esquecer tira dos recentes e do espaço de trabalho', () => {
  const e = esquecerPasta(abrirPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b'), '/b');
  assert.deepEqual(e.pastas, []);
  assert.deepEqual(e.recentes, ['/a']);
});

test('esquecer outra pasta não mexe na que está aberta', () => {
  const e = esquecerPasta(abrirPasta(abrirPasta(ESTADO_VAZIO, '/a'), '/b'), '/a');
  assert.deepEqual(e.pastas, ['/b']);
  assert.deepEqual(e.recentes, ['/b']);
});
