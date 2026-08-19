import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dividir, gruposDe, LAYOUT_INICIAL, MAX_GRUPOS, normalizarLayout, podeDividir,
  proximoGrupo, removerGrupo, type NoDeLayout,
} from '../layout-editor';

/** Desenha a árvore numa linha, para as asserções lerem como a tela se parece. */
function desenhar(no: NoDeLayout): string {
  if (no.tipo === 'grupo') return String(no.grupo);
  const sep = no.orientacao === 'horizontal' ? ' | ' : ' / ';
  return `(${no.filhos.map(desenhar).join(sep)})`;
}

test('a IDE começa com um grupo só', () => {
  assert.deepEqual(gruposDe(LAYOUT_INICIAL), [0]);
  assert.equal(desenhar(LAYOUT_INICIAL), '0');
});

test('dividir à direita põe o novo depois', () => {
  assert.equal(desenhar(dividir(LAYOUT_INICIAL, 0, 'direita', 1)), '(0 | 1)');
});

test('dividir à esquerda põe o novo ANTES', () => {
  assert.equal(desenhar(dividir(LAYOUT_INICIAL, 0, 'esquerda', 1)), '(1 | 0)');
});

test('dividir para baixo empilha', () => {
  assert.equal(desenhar(dividir(LAYOUT_INICIAL, 0, 'baixo', 1)), '(0 / 1)');
});

test('dividir para cima empilha ao contrário', () => {
  assert.equal(desenhar(dividir(LAYOUT_INICIAL, 0, 'cima', 1)), '(1 / 0)');
});

test('MESMA orientação vira IRMÃ, não aninhada', () => {
  // É a regra que separa três colunas iguais de uma coluna dentro de outra —
  // e, na tela, a terceira nascendo com metade da largura da segunda.
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'direita', 2);
  assert.equal(desenhar(l), '(0 | 1 | 2)');
});

test('orientação DIFERENTE aninha, que é o que se pede', () => {
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'baixo', 2);
  assert.equal(desenhar(l), '(0 | (1 / 2))');
});

test('dividir à esquerda de um irmão do meio respeita a posição', () => {
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'direita', 2);
  l = dividir(l, 1, 'esquerda', 3);
  assert.equal(desenhar(l), '(0 | 3 | 1 | 2)');
});

test('dividir um grupo que não existe não muda nada', () => {
  const l = dividir(LAYOUT_INICIAL, 99, 'direita', 1);
  assert.equal(desenhar(l), '0');
});

test('dividir não muta o arranjo anterior', () => {
  const antes = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  dividir(antes, 1, 'baixo', 2);
  assert.equal(desenhar(antes), '(0 | 1)');
});

// ---- remoção ----

test('remover um dos dois colapsa a divisão', () => {
  const l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  // Sobrar uma moldura vazia em volta de um grupo seria nível morto na árvore.
  assert.equal(desenhar(removerGrupo(l, 1)), '0');
});

test('remover do meio de três deixa dois lado a lado', () => {
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'direita', 2);
  assert.equal(desenhar(removerGrupo(l, 1)), '(0 | 2)');
});

test('remover colapsa também o aninhado', () => {
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'baixo', 2);
  assert.equal(desenhar(l), '(0 | (1 / 2))');
  assert.equal(desenhar(removerGrupo(l, 2)), '(0 | 1)');
});

test('remover o último devolve o arranjo inicial, nunca vazio', () => {
  assert.equal(desenhar(removerGrupo(LAYOUT_INICIAL, 0)), '0');
});

test('remover grupo inexistente não muda nada', () => {
  const l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  assert.equal(desenhar(removerGrupo(l, 99)), '(0 | 1)');
});

// ---- numeração ----

test('o próximo grupo reaproveita buraco', () => {
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'direita', 2);
  assert.equal(proximoGrupo(l), 3);

  // Fechar o do meio libera o número 1.
  assert.equal(proximoGrupo(removerGrupo(l, 1)), 1);
});

test('há um teto de grupos — mosaico ilegível não é feature', () => {
  let l = LAYOUT_INICIAL;
  for (let n = 1; n < MAX_GRUPOS; n += 1) l = dividir(l, n - 1, 'direita', n);
  assert.equal(gruposDe(l).length, MAX_GRUPOS);
  assert.equal(podeDividir(l), false);
});

// ---- reconciliação com o store de abas ----

test('grupo sem aba nenhuma sai do arranjo', () => {
  let l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  l = dividir(l, 1, 'baixo', 2);
  // Só 0 e 2 têm aba: o arranjo precisa acompanhar.
  assert.equal(desenhar(normalizarLayout(l, new Set([0, 2]))), '(0 | 2)');
});

test('sem grupo vivo nenhum, volta ao inicial', () => {
  const l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  assert.equal(desenhar(normalizarLayout(l, new Set())), '0');
});

test('normalizar com todos vivos devolve o mesmo desenho', () => {
  const l = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  assert.equal(desenhar(normalizarLayout(l, new Set([0, 1]))), '(0 | 1)');
});
