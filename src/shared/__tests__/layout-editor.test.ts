import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dividir, gruposDe, LAYOUT_INICIAL, MINIMO_DA_DIVISAO, normalizarLayout, podeDividir,
  proximoGrupo, redimensionar, removerGrupo, tamanhosDe, type NoDeLayout,
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

// ---------------------------------------------------------------------------
// Sem teto de grupos (T019) e proporção guardada (T021) — spec 072
// ---------------------------------------------------------------------------

test('não há mais teto de grupos: ele pediu "sem teto, como o VS Code"', () => {
  // O teto de seis era meu, com a desculpa "mantém a barra de abas legível".
  // Quem decide quantas colunas cabem na tela dele é ele.
  let arranjo = LAYOUT_INICIAL;
  for (let n = 1; n <= 12; n += 1) {
    assert.equal(podeDividir(arranjo), true, `no ${n}º`);
    arranjo = dividir(arranjo, n - 1, 'direita', n);
  }
  assert.equal(gruposDe(arranjo).length, 13);
});

test('a divisão nasce meio a meio, e a soma é sempre 1', () => {
  const dois = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  assert.deepEqual(tamanhosDe(dois), [0.5, 0.5]);

  const tres = dividir(dois, 1, 'direita', 2);
  const t = tamanhosDe(tres);
  assert.equal(t.length, 3);
  assert.ok(Math.abs(t.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('o grupo novo nasce do espaço DO ALVO, e não do de todos', () => {
  // Dividir a segunda coluna não pode estreitar a primeira, que ele já
  // ajustou a mão. O espaço sai de quem foi dividido.
  const tres = dividir(dividir(LAYOUT_INICIAL, 0, 'direita', 1), 1, 'direita', 2);
  assert.deepEqual(tamanhosDe(tres), [0.5, 0.25, 0.25]);
});

test('redimensionar move a fronteira ENTRE dois vizinhos, e não mexe nos outros', () => {
  const tres = dividir(dividir(LAYOUT_INICIAL, 0, 'direita', 1), 1, 'direita', 2);
  const antes = tamanhosDe(tres);
  const t = tamanhosDe(redimensionar(tres, [], 0, 0.6));

  assert.ok(Math.abs(t[0] - 0.6) < 1e-9);
  // O par troca espaço entre si: a soma dos dois é a mesma de antes.
  assert.ok(Math.abs(t[0] + t[1] - (antes[0] + antes[1])) < 1e-9);
  // E o terceiro não sente nada — é o ponto do teste.
  assert.ok(Math.abs(t[2] - antes[2]) < 1e-9);
});

test('a fronteira não passa por cima do vizinho: há um mínimo', () => {
  const dois = dividir(LAYOUT_INICIAL, 0, 'direita', 1);
  // Um grupo de largura zero não é grupo: some da tela e não dá para trazer de
  // volta com o mouse, porque não há o que agarrar.
  const espremido = redimensionar(dois, [], 0, 0.99);
  const t = tamanhosDe(espremido);
  assert.ok(t[1] >= MINIMO_DA_DIVISAO - 1e-9, `sobrou ${String(t[1])}`);
  assert.ok(t[0] <= 1 - MINIMO_DA_DIVISAO + 1e-9);
});

test('fechar um grupo redistribui o espaço dele, sem deixar buraco', () => {
  const tres = dividir(dividir(LAYOUT_INICIAL, 0, 'direita', 1), 1, 'direita', 2);
  const dois = removerGrupo(tres, 1);
  const t = tamanhosDe(dois);
  assert.equal(t.length, 2);
  assert.ok(Math.abs(t.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('arranjo vindo do disco sem tamanhos abre meio a meio', () => {
  // Sessão gravada por uma versão anterior: nunca um layout quebrado.
  const antigo = {
    tipo: 'divisao' as const,
    orientacao: 'horizontal' as const,
    filhos: [
      { tipo: 'grupo' as const, grupo: 0 },
      { tipo: 'grupo' as const, grupo: 1 },
      { tipo: 'grupo' as const, grupo: 2 },
    ],
  };
  assert.deepEqual(
    tamanhosDe(antigo).map((n) => Math.round(n * 1000) / 1000),
    [0.333, 0.333, 0.333]
  );
});
