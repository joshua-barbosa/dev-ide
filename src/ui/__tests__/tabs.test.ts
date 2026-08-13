// Testes do store de abas.
//
// O store vive em public/js/tabs.js como JS puro (o frontend não tem bundler),
// mas é lógica de estado sem DOM — então roda em node normalmente.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';

interface Tab {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly icon?: string;
  readonly dirty: boolean;
  readonly meta: Record<string, unknown>;
}

interface TabStore {
  list(): Tab[];
  activeId(): string | null;
  active(): Tab | null;
  get(id: string): Tab | null;
  open(input: Partial<Tab> & { id: string; type: string; title: string }): Tab;
  close(id: string): void;
  activate(id: string): void;
  update(id: string, patch: Partial<Tab>): Tab | null;
  onChange(listener: (tabs: Tab[], activeId: string | null) => void): () => void;
}

const TABS_JS = path.join(__dirname, '..', '..', '..', 'public', 'js', 'tabs.js');
const { createTabStore } = require(TABS_JS) as { createTabStore: () => TabStore };

function comTres(): TabStore {
  const store = createTabStore();
  store.open({ id: 'a', type: 'editor', title: 'a.ts' });
  store.open({ id: 'b', type: 'editor', title: 'b.ts' });
  store.open({ id: 'c', type: 'grid', title: 'Resultado' });
  return store;
}

// ---- abrir ----

test('abrir adiciona a aba e a torna ativa', () => {
  const store = createTabStore();
  const aba = store.open({ id: 'a', type: 'editor', title: 'a.ts' });
  assert.equal(aba.id, 'a');
  assert.equal(aba.dirty, false);
  assert.equal(store.activeId(), 'a');
  assert.deepEqual(store.list().map((t) => t.id), ['a']);
});

test('abrir um id já existente foca em vez de duplicar', () => {
  const store = comTres();
  store.open({ id: 'a', type: 'editor', title: 'a.ts' });
  assert.deepEqual(store.list().map((t) => t.id), ['a', 'b', 'c'], 'não pode duplicar');
  assert.equal(store.activeId(), 'a', 'e precisa focar a existente');
});

test('reabrir preserva o estado da aba (dirty não some)', () => {
  const store = createTabStore();
  store.open({ id: 'a', type: 'editor', title: 'a.ts' });
  store.update('a', { dirty: true });
  store.open({ id: 'b', type: 'editor', title: 'b.ts' });

  store.open({ id: 'a', type: 'editor', title: 'a.ts' });
  assert.equal(store.get('a')?.dirty, true);
});

test('abrir preserva a ordem de inserção', () => {
  const store = comTres();
  assert.deepEqual(store.list().map((t) => t.title), ['a.ts', 'b.ts', 'Resultado']);
});

// ---- fechar ----

test('fechar a aba ativa ativa a vizinha à direita', () => {
  const store = comTres();
  store.activate('b');
  store.close('b');
  assert.equal(store.activeId(), 'c');
  assert.deepEqual(store.list().map((t) => t.id), ['a', 'c']);
});

test('fechar a última aba ativa cai para a da esquerda', () => {
  const store = comTres();
  store.activate('c');
  store.close('c');
  assert.equal(store.activeId(), 'b');
});

test('fechar aba inativa não muda a ativa', () => {
  const store = comTres();
  store.activate('c');
  store.close('a');
  assert.equal(store.activeId(), 'c');
});

test('fechar a única aba deixa o editor sem aba ativa', () => {
  const store = createTabStore();
  store.open({ id: 'a', type: 'editor', title: 'a.ts' });
  store.close('a');
  assert.equal(store.activeId(), null);
  assert.equal(store.active(), null);
  assert.deepEqual(store.list(), []);
});

test('fechar id inexistente é no-op', () => {
  const store = comTres();
  store.close('zzz');
  assert.deepEqual(store.list().map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(store.activeId(), 'c', 'a última aberta continua ativa');
});

// ---- ativar e atualizar ----

test('ativar id inexistente não muda nada', () => {
  const store = comTres();
  store.activate('zzz');
  assert.equal(store.activeId(), 'c');
});

test('abrir sempre ativa a aba recém-criada', () => {
  const store = comTres();
  assert.equal(store.activeId(), 'c');
});

test('update aplica patch e devolve a aba nova', () => {
  const store = comTres();
  const atualizada = store.update('a', { title: 'a.ts (renomeado)', dirty: true });
  assert.equal(atualizada?.title, 'a.ts (renomeado)');
  assert.equal(store.get('a')?.dirty, true);
  assert.equal(store.get('b')?.dirty, false, 'não pode vazar para as outras');
});

test('update não muta a aba anterior', () => {
  const store = comTres();
  const antes = store.get('a')!;
  store.update('a', { dirty: true });
  assert.equal(antes.dirty, false, 'a referência anterior deve continuar intacta');
});

test('update em id inexistente devolve null', () => {
  const store = comTres();
  assert.equal(store.update('zzz', { dirty: true }), null);
});

test('list devolve cópia: mexer no retorno não afeta o store', () => {
  const store = comTres();
  store.list().pop();
  assert.equal(store.list().length, 3);
});

// ---- notificação ----

test('onChange dispara em abrir, ativar, atualizar e fechar', () => {
  const store = createTabStore();
  const eventos: Array<{ ids: string[]; ativo: string | null }> = [];
  store.onChange((tabs, activeId) => eventos.push({ ids: tabs.map((t) => t.id), ativo: activeId }));

  store.open({ id: 'a', type: 'editor', title: 'a' });
  store.open({ id: 'b', type: 'editor', title: 'b' });
  store.activate('a');
  store.update('a', { dirty: true });
  store.close('a');

  assert.equal(eventos.length, 5);
  assert.deepEqual(eventos[4], { ids: ['b'], ativo: 'b' });
});

test('onChange devolve função para cancelar a inscrição', () => {
  const store = createTabStore();
  let chamadas = 0;
  const cancelar = store.onChange(() => (chamadas += 1));
  store.open({ id: 'a', type: 'editor', title: 'a' });
  cancelar();
  store.open({ id: 'b', type: 'editor', title: 'b' });
  assert.equal(chamadas, 1);
});

test('mexer no store dentro de um listener re-notifica (reentrância)', () => {
  // Contrato afiado: quem salva estado no onChange (chamando update) dispara o
  // listener de novo. Sem uma guarda no consumidor isso vira recursão infinita
  // e trava a aba do navegador — já aconteceu. O teste existe para o
  // comportamento não mudar silenciosamente.
  const store = createTabStore();
  store.open({ id: 'a', type: 'editor', title: 'a' });

  let profundidade = 0;
  let maxProfundidade = 0;
  store.onChange((_tabs, activeId) => {
    profundidade += 1;
    maxProfundidade = Math.max(maxProfundidade, profundidade);
    // Só reentra uma vez, senão o próprio teste recursa para sempre.
    if (profundidade === 1 && activeId === 'b') store.update('a', { dirty: true });
    profundidade -= 1;
  });

  store.open({ id: 'b', type: 'editor', title: 'b' });
  assert.equal(maxProfundidade, 2, 'update dentro do listener precisa notificar de novo');
  assert.equal(store.get('a')?.dirty, true);
});

test('fechar a última aba notifica com activeId null', () => {
  // O consumidor distingue "nenhuma aba" por activeId === null; se este evento
  // não chegar, a status bar fica presa no último arquivo aberto.
  const store = createTabStore();
  store.open({ id: 'a', type: 'editor', title: 'a' });

  const ativos: Array<string | null> = [];
  store.onChange((_tabs, activeId) => ativos.push(activeId));
  store.close('a');

  assert.deepEqual(ativos, [null]);
});

test('um listener que estoura não impede os outros', () => {
  const store = createTabStore();
  let chamado = false;
  store.onChange(() => {
    throw new Error('listener quebrado');
  });
  store.onChange(() => (chamado = true));
  store.open({ id: 'a', type: 'editor', title: 'a' });
  assert.equal(chamado, true);
});
