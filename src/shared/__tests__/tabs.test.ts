// Testes do store de abas.
//
// O store é lógica de estado sem DOM, então roda em node:test direto — é a
// razão de ele viver em `shared` e não junto dos componentes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTabStore, type TabStore } from '../tabs';

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

// ---------------------------------------------------------------------------
// Grupos de editor (spec 020)
// ---------------------------------------------------------------------------
//
// A regra que orientou o desenho: **com um grupo só, tudo se comporta como
// antes.** Os vinte testes acima passaram sem uma linha de mudança, e isso é a
// afirmação mais importante desta seção — o resto verifica o que é novo.

function comAbas(...ids: string[]) {
  const store = createTabStore();
  for (const id of ids) store.open({ id, type: 'editor', title: id });
  return store;
}

test('sem aba nenhuma, ainda existe um grupo', () => {
  // O editor precisa de onde morar mesmo com a tela vazia.
  assert.deepEqual(createTabStore().grupos(), [0]);
});

test('abas novas nascem no grupo focado', () => {
  const store = comAbas('a', 'b');
  assert.deepEqual(store.grupos(), [0]);
  assert.deepEqual(store.doGrupo(0).map((t) => t.id), ['a', 'b']);
});

test('mover cria o segundo grupo e leva o foco junto', () => {
  const store = comAbas('a', 'b');
  store.mover('b', 1);

  assert.deepEqual(store.grupos(), [0, 1]);
  assert.deepEqual(store.doGrupo(0).map((t) => t.id), ['a']);
  assert.deepEqual(store.doGrupo(1).map((t) => t.id), ['b']);
  assert.equal(store.grupoFocado(), 1);
  assert.equal(store.activeId(), 'b');
});

test('cada grupo guarda a PRÓPRIA ativa', () => {
  const store = comAbas('a', 'b', 'c');
  store.mover('c', 1);
  store.activate('a');

  assert.equal(store.ativaDoGrupo(0), 'a');
  assert.equal(store.ativaDoGrupo(1), 'c', 'o outro lado não perdeu a dele');
  assert.equal(store.activeId(), 'a', 'a ativa global é a do grupo focado');
});

test('focar um grupo troca qual ativa é a global, sem mexer nas abas', () => {
  const store = comAbas('a', 'b');
  store.mover('b', 1);
  store.focarGrupo(0);

  assert.equal(store.activeId(), 'a');
  store.focarGrupo(1);
  assert.equal(store.activeId(), 'b');
});

test('mover a ativa faz o grupo de origem escolher outra', () => {
  const store = comAbas('a', 'b', 'c');
  store.activate('b');
  store.mover('b', 1);

  // Vizinha à direita, dentro do grupo — a mesma regra de sempre.
  assert.equal(store.ativaDoGrupo(0), 'c');
  assert.equal(store.ativaDoGrupo(1), 'b');
});

test('fechar a última aba de um grupo faz o grupo sumir', () => {
  const store = comAbas('a', 'b');
  store.mover('b', 1);
  store.close('b');

  assert.deepEqual(store.grupos(), [0], 'sobrar uma metade em branco seria pior');
  assert.equal(store.grupoFocado(), 0);
  assert.equal(store.activeId(), 'a');
});

test('fechar aba de um grupo não mexe na ativa do outro', () => {
  const store = comAbas('a', 'b', 'c');
  store.mover('c', 1);
  store.activate('a');
  store.close('b');

  assert.equal(store.ativaDoGrupo(1), 'c');
});

test('reabrir aba que está no outro grupo leva o foco até ela', () => {
  const store = comAbas('a', 'b');
  store.mover('b', 1);
  store.focarGrupo(0);

  store.open({ id: 'b', type: 'editor', title: 'b' });
  assert.equal(store.grupoFocado(), 1, 'reabrir não pode duplicar nem ficar parado');
  assert.equal(store.doGrupo(1).length, 1);
});

test('mover para o mesmo grupo não faz nada', () => {
  const store = comAbas('a', 'b');
  store.activate('a');
  store.mover('a', 0);
  assert.equal(store.ativaDoGrupo(0), 'a');
  assert.deepEqual(store.grupos(), [0]);
});

test('mover id inexistente é ignorado', () => {
  const store = comAbas('a');
  store.mover('zzz', 1);
  assert.deepEqual(store.grupos(), [0]);
});

test('abrir com grupo explícito respeita o pedido', () => {
  const store = comAbas('a');
  store.open({ id: 'b', type: 'editor', title: 'b', grupo: 1 });
  assert.equal(store.get('b')?.grupo, 1);
  assert.equal(store.grupoFocado(), 1);
});

test('update preserva o grupo quando o patch não o menciona', () => {
  const store = comAbas('a');
  store.mover('a', 1);
  store.update('a', { title: 'outro' });
  assert.equal(store.get('a')?.grupo, 1);
});

test('o listener recebe a ativa do grupo focado', () => {
  const store = comAbas('a', 'b');
  let visto: string | null = 'nada';
  store.onChange((_tabs, activeId) => { visto = activeId; });

  store.mover('b', 1);
  assert.equal(visto, 'b');
  store.focarGrupo(0);
  assert.equal(visto, 'a');
});
