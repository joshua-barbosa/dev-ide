import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aoArrastar, definir, esquecer, larguraDoCabecalho, larguraDoConteudo, LARGURA_MINIMA,
  TETO_AUTOMATICO,
} from '../grade/larguras';

test('arrastar para a direita alarga, para a esquerda estreita', () => {
  assert.equal(aoArrastar(200, 50), 250);
  assert.equal(aoArrastar(200, -50), 150);
});

test('o mínimo é uma parede: arrastar muito para a esquerda para nele', () => {
  assert.equal(aoArrastar(100, -500), LARGURA_MINIMA);
});

test('arrastar guarda a largura RESULTANTE, então dois arrastos não somam errado', () => {
  // O primeiro bate no mínimo. Se guardássemos o delta, o segundo devolveria a
  // coluna a 190 (100 - 500 + 590); guardando o resultado, ele parte de 48.
  const depoisDoPrimeiro = aoArrastar(100, -500);
  assert.equal(aoArrastar(depoisDoPrimeiro, 590), 638);
});

test('definir devolve o MESMO objeto quando a largura não muda', () => {
  const antes = { nome: 200 };
  assert.equal(definir(antes, 'nome', 200), antes);
  assert.notEqual(definir(antes, 'nome', 201), antes);
});

test('definir não deixa passar do mínimo, venha de onde vier', () => {
  assert.deepEqual(definir({}, 'x', 3), { x: LARGURA_MINIMA });
});

test('esquecer tira a coluna, e devolve o mesmo objeto se ela não estava lá', () => {
  const antes = { a: 100, b: 200 };
  assert.deepEqual(esquecer(antes, 'a'), { b: 200 });
  assert.equal(esquecer(antes, 'c'), antes);
});

test('a largura do conteúdo cresce com o texto mais longo, não com a média', () => {
  const curta = larguraDoConteudo(['a', 'bb'], 8);
  const longa = larguraDoConteudo(['a', 'b'.repeat(40)], 8);
  assert.ok(longa > curta);
});

test('o conteúdo tem teto: um JSON de 4000 caracteres não vira uma coluna de 32000 px', () => {
  assert.equal(larguraDoConteudo(['x'.repeat(4000)], 8), TETO_AUTOMATICO);
});

test('coluna curta nasce ESTREITA — foi o que o navegador mostrou que faltava', () => {
  // `id` com valores de dois dígitos não pode ocupar o mesmo que uma coluna de
  // JSON. Com o teto fixo para todas, dez colunas viravam quatro na tela.
  const id = larguraDoConteudo(['id', '49', '50', '51'], 7.2);
  const json = larguraDoConteudo(['data', '{"ip":"127.0.0.1","browser":"Symfony"}'], 7.2);
  assert.ok(id < json, `id=${id} json=${json}`);
  assert.ok(id < 100, `id=${id}`);
});

test('coluna vazia ainda tem o mínimo', () => {
  assert.equal(larguraDoConteudo([], 8), LARGURA_MINIMA);
});

test('o cabeçalho cabe nome E tipo, que agora dividem a linha', () => {
  // `id` com tipo `INTEGER`: enquanto o tipo ficava empilhado, bastava o maior
  // dos dois. Na mesma linha, a coluna precisa caber a soma.
  const so_nome = larguraDoCabecalho('id', '', 7.2, 6);
  const com_tipo = larguraDoCabecalho('id', 'INTEGER', 7.2, 6);
  assert.ok(com_tipo > so_nome);
  assert.ok(com_tipo >= Math.ceil(2 * 7.2 + 7 * 6 + 8) + 24);
});

test('sem tipo não há folga cobrada', () => {
  assert.equal(larguraDoCabecalho('alunos', '', 7.2, 6), larguraDoCabecalho('alunos', '', 7.2, 6));
});
