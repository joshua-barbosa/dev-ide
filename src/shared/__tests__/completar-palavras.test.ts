// Completar pelas palavras do arquivo (T114).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { palavraAntesDoCursor, palavrasDoTexto } from '../completar-palavras';

test('quem repete mais aparece antes', () => {
  const p = palavrasDoTexto('conexao conexao conexao servidor servidor porta');
  assert.deepEqual(p.map((x) => x.texto), ['conexao', 'servidor', 'porta']);
  assert.equal(p[0]?.vezes, 3);
});

test('empate sai em ordem alfabética — e não dança a cada tecla', () => {
  // Sem critério estável, a mesma lista sairia em ordens diferentes a cada
  // digitação, e a primeira sugestão fugiria de baixo do dedo.
  const p = palavrasDoTexto('zebra alfa meio');
  assert.deepEqual(p.map((x) => x.texto), ['alfa', 'meio', 'zebra']);
});

test('palavra curta demais não vale', () => {
  // Ninguém precisa completar `id`.
  assert.deepEqual(palavrasDoTexto('id de um no').map((x) => x.texto), []);
});

test('número puro não é sugestão', () => {
  // `2026` sugerido no meio do código é ruído.
  const p = palavrasDoTexto('const ano = 2026; const versao2 = 1;');
  assert.equal(p.some((x) => x.texto === '2026'), false);
  assert.equal(p.some((x) => x.texto === 'versao2'), true);
});

test('acento entra — código em português é o caso dele', () => {
  // `\w` do JavaScript não inclui acento, e por isso a classe é escrita à mão.
  const p = palavrasDoTexto('configuração configuração operação');
  assert.deepEqual(p.map((x) => x.texto), ['configuração', 'operação']);
});

test('a palavra sendo digitada NÃO é sugerida de volta', () => {
  // Seria a sugestão mais inútil possível, e apareceria em primeiro lugar.
  const p = palavrasDoTexto('conexao conexao conf', 'conf');
  assert.equal(p.some((x) => x.texto === 'conf'), false);
  assert.equal(p[0]?.texto, 'conexao');
});

test('`_` e `$` fazem parte da palavra', () => {
  const p = palavrasDoTexto('meu_nome $escopo meu_nome');
  assert.deepEqual(p.map((x) => x.texto), ['meu_nome', '$escopo']);
});

test('a palavra antes do cursor é o que se está digitando', () => {
  // Coluna é 1-based e o cursor fica ANTES do caractere daquela coluna:
  // em `const confi` a coluna 12 é o fim da linha, com `confi` atrás.
  assert.equal(palavraAntesDoCursor('const confi', 12), 'confi');
  assert.equal(palavraAntesDoCursor('const confi', 8), 'c');
  // Logo depois do espaço (coluna 7), ainda não há palavra começada.
  assert.equal(palavraAntesDoCursor('const confi', 7), '');
  assert.equal(palavraAntesDoCursor('obj.', 5), '');
});

test('texto vazio não quebra', () => {
  assert.deepEqual(palavrasDoTexto(''), []);
  assert.equal(palavraAntesDoCursor('', 1), '');
});
