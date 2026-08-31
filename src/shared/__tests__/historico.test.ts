import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avancar, esquecerAba, HISTORICO_VAZIO, MAX_POSICOES, podeAvancar, podeVoltar, registrar,
  voltar, type Historico, type Posicao,
} from '../historico';

const p = (abaId: string, linha = 1): Posicao => ({ abaId, linha });
const sempre = (): boolean => true;

function comSaltos(...posicoes: Posicao[]): Historico {
  return posicoes.reduce(registrar, HISTORICO_VAZIO);
}

test('sem histórico não há para onde ir', () => {
  assert.equal(podeVoltar(HISTORICO_VAZIO), false);
  assert.equal(podeAvancar(HISTORICO_VAZIO), false);
  assert.equal(voltar(HISTORICO_VAZIO, sempre).destino, null);
});

test('com uma posição só, ainda não há para onde voltar', () => {
  const h = comSaltos(p('a'));
  assert.equal(podeVoltar(h), false);
  assert.equal(podeAvancar(h), false);
});

test('voltar leva à posição anterior', () => {
  const { historico, destino } = voltar(comSaltos(p('a', 1), p('b', 10)), sempre);
  assert.deepEqual(destino, p('a', 1));
  assert.equal(podeAvancar(historico), true);
});

test('avançar refaz o caminho', () => {
  const depoisDeVoltar = voltar(comSaltos(p('a'), p('b')), sempre).historico;
  const { destino } = avancar(depoisDeVoltar, sempre);
  assert.deepEqual(destino, p('b'));
});

test('navegar depois de voltar descarta o que estava à frente', () => {
  // A regra que erra quando se implementa de cabeça.
  const voltou = voltar(comSaltos(p('a'), p('b'), p('c')), sempre).historico;
  const novo = registrar(voltou, p('d'));

  assert.deepEqual(novo.posicoes.map((x) => x.abaId), ['a', 'b', 'd']);
  assert.equal(podeAvancar(novo), false, '"c" deixou de existir');
});

test('a mesma posição duas vezes seguidas não empilha', () => {
  const h = comSaltos(p('a', 5), p('a', 5));
  assert.equal(h.posicoes.length, 1);
});

test('a mesma aba em linha diferente empilha', () => {
  assert.equal(comSaltos(p('a', 5), p('a', 40)).posicoes.length, 2);
});

test('o histórico tem teto, e o que se perde é o passado distante', () => {
  let h = HISTORICO_VAZIO;
  for (let i = 0; i < MAX_POSICOES + 10; i += 1) h = registrar(h, p(`aba-${i}`));

  assert.equal(h.posicoes.length, MAX_POSICOES);
  assert.equal(h.posicoes[h.posicoes.length - 1]?.abaId, `aba-${MAX_POSICOES + 9}`);
  assert.equal(h.indice, MAX_POSICOES - 1, 'o índice acompanha o corte');
});

test('registrar não muta o histórico anterior', () => {
  const antes = comSaltos(p('a'));
  registrar(antes, p('b'));
  assert.equal(antes.posicoes.length, 1);
});

// ---- abas fechadas ----

test('voltar pula posição que não dá mais para alcançar', () => {
  const h = comSaltos(p('a'), p('fechada'), p('c'));
  const { destino } = voltar(h, (q) => q.abaId !== 'fechada');
  assert.deepEqual(destino, p('a'), 'pulou a do meio em vez de falhar');
});

test('sem destino válido, o índice não anda', () => {
  const h = comSaltos(p('fechada'), p('c'));
  const { historico, destino } = voltar(h, (q) => q.abaId !== 'fechada');
  assert.equal(destino, null);
  assert.equal(historico.indice, h.indice, 'ficar num lugar sem volta seria pior');
});

// ---- voltar para arquivo já FECHADO (T011, spec 073) ----

const comArquivo = (abaId: string, caminho: string, linha = 1): Posicao =>
  ({ abaId, linha, caminho });

test('a posição de uma aba fechada COM caminho continua alcançável', () => {
  // Antes do T011 ela era pulada em silêncio, e `Back` atravessava meia sessão
  // de navegação até achar uma aba viva.
  const h = comSaltos(p('a'), comArquivo('fechada', '/p/b.ts', 42), p('c'));
  const viva = (q: Posicao): boolean => q.abaId !== 'fechada' || q.caminho !== undefined;

  const { destino } = voltar(h, viva);
  assert.deepEqual(destino, comArquivo('fechada', '/p/b.ts', 42));
});

test('aba fechada SEM caminho continua sendo pulada', () => {
  // Aba sem título e aba de query não existem em disco: não há o que reabrir.
  const h = comSaltos(p('a'), p('sem-titulo'), p('c'));
  const viva = (q: Posicao): boolean => q.abaId !== 'sem-titulo';
  assert.deepEqual(voltar(h, viva).destino, p('a'));
});

test('o caminho não muda o que conta como a MESMA posição', () => {
  const h = comSaltos(comArquivo('a', '/p/a.ts', 3), comArquivo('a', '/p/a.ts', 3));
  assert.equal(h.posicoes.length, 1, 'saltar para onde já se está não empilha');
});

test('esquecerAba tira as posições dela e ajusta o índice', () => {
  const h = comSaltos(p('a'), p('x'), p('b'), p('x'));
  const depois = esquecerAba(h, 'x');
  assert.deepEqual(depois.posicoes.map((q) => q.abaId), ['a', 'b']);
  assert.ok(depois.indice < depois.posicoes.length);
  assert.ok(depois.indice >= 0);
});

test('esquecer a única aba deixa o histórico vazio', () => {
  const depois = esquecerAba(comSaltos(p('a'), p('a', 2)), 'a');
  assert.deepEqual(depois.posicoes, []);
  assert.equal(depois.indice, -1);
});

test('esquecer aba que não está no histórico devolve o mesmo objeto', () => {
  const antes = comSaltos(p('a'));
  assert.equal(esquecerAba(antes, 'zzz'), antes);
});
