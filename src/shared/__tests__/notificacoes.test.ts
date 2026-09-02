// Notificações empilháveis e o sino (T107).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DURACAO, empilhar, MAX_NA_PILHA, MAX_NO_HISTORICO, naoLidos, noHistorico, tipoDoErro,
  type Aviso, type TipoDeAviso,
} from '../notificacoes';

const a = (id: string, tipo: TipoDeAviso = 'info', quando = 0): Aviso =>
  ({ id, tipo, quando, mensagem: id });

test('erro NÃO some sozinho', () => {
  // Um erro que passa voando é pior que erro nenhum: dá a sensação de que algo
  // aconteceu sem dizer o quê.
  assert.equal(DURACAO.erro, null);
  for (const tipo of ['info', 'sucesso', 'atencao'] as const) {
    assert.ok((DURACAO[tipo] ?? 0) > 0, tipo);
  }
});

test('a pilha guarda até o teto', () => {
  let pilha: readonly Aviso[] = [];
  for (let i = 0; i < MAX_NA_PILHA; i += 1) pilha = empilhar(pilha, a(`n${i}`));
  assert.equal(pilha.length, MAX_NA_PILHA);
});

test('cheia, sai a mais VELHA — e não a nova é recusada', () => {
  // O aviso recém-chegado é o que descreve o que acabou de acontecer.
  let pilha: readonly Aviso[] = [];
  for (let i = 0; i < MAX_NA_PILHA + 1; i += 1) pilha = empilhar(pilha, a(`n${i}`));
  assert.equal(pilha.length, MAX_NA_PILHA);
  assert.equal(pilha.some((x) => x.id === 'n0'), false, 'a mais velha saiu');
  assert.equal(pilha.at(-1)?.id, `n${MAX_NA_PILHA}`, 'a nova entrou');
});

test('um ERRO não é empurrado para fora por avisos comuns', () => {
  // Quatro "arquivo salvo" seguidos apagariam da tela o erro que veio antes, e
  // é o erro que precisava ser lido.
  let pilha: readonly Aviso[] = [a('falhou', 'erro')];
  for (let i = 0; i < 10; i += 1) pilha = empilhar(pilha, a(`ok${i}`, 'sucesso'));
  assert.ok(pilha.some((x) => x.id === 'falhou'), 'o erro sobreviveu');
  assert.equal(pilha.length, MAX_NA_PILHA);
});

test('só de erros, o mais velho sai — a pilha não cresce para sempre', () => {
  let pilha: readonly Aviso[] = [];
  for (let i = 0; i < MAX_NA_PILHA + 3; i += 1) pilha = empilhar(pilha, a(`e${i}`, 'erro'));
  assert.equal(pilha.length, MAX_NA_PILHA);
  assert.equal(pilha.some((x) => x.id === 'e0'), false);
});

test('o histórico vem do mais NOVO, com teto', () => {
  let h: readonly Aviso[] = [];
  for (let i = 0; i < MAX_NO_HISTORICO + 10; i += 1) h = noHistorico(h, a(`h${i}`));
  assert.equal(h.length, MAX_NO_HISTORICO);
  assert.equal(h[0]?.id, `h${MAX_NO_HISTORICO + 9}`, 'o mais novo na frente');
});

test('não lidos é o que chegou depois da última olhada', () => {
  const h = [a('novo', 'info', 300), a('meio', 'info', 200), a('velho', 'info', 100)];
  assert.equal(naoLidos(h, 0), 3);
  assert.equal(naoLidos(h, 200), 1);
  assert.equal(naoLidos(h, 999), 0);
});

test('cancelar NÃO é erro', () => {
  // Cancelar é escolha dele; pintar de vermelho o que ele mesmo pediu é acusar
  // o usuário de um problema que não existe.
  assert.equal(tipoDoErro('O download foi cancelado.'), 'info');
  assert.equal(tipoDoErro('A operação foi cancelada'), 'info');
  assert.equal(tipoDoErro('Falha ao conectar no bastion'), 'erro');
});
