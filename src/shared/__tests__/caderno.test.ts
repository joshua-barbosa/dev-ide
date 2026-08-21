import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acrescentar,
  alterar,
  blocosExecutaveis,
  escreverCaderno,
  lerCaderno,
  mover,
  remover,
  VERSAO_DO_CADERNO,
} from '../sql/caderno';

const doJson = (obj: unknown): string => JSON.stringify(obj);

// ---------------------------------------------------------------------------
// Ler e gravar
// ---------------------------------------------------------------------------

test('grava e lê de volta, preservando ordem e tipo', () => {
  const caderno = {
    celulas: [
      { id: 'c0', tipo: 'markdown' as const, conteudo: '# Chamado 64158' },
      { id: 'c1', tipo: 'sql' as const, conteudo: 'SELECT 1' },
    ],
  };
  const lido = lerCaderno(escreverCaderno(caderno));
  assert.deepEqual(
    lido.celulas.map((c) => [c.tipo, c.conteudo]),
    [['markdown', '# Chamado 64158'], ['sql', 'SELECT 1']]
  );
});

test('o arquivo gravado declara a versão do formato', () => {
  const dados = JSON.parse(escreverCaderno({ celulas: [] })) as { versao: number };
  assert.equal(dados.versao, VERSAO_DO_CADERNO);
});

test('o id NÃO vai para o arquivo — ele é de tela, não de dado', () => {
  const texto = escreverCaderno({ celulas: [{ id: 'c0', tipo: 'sql', conteudo: 'x' }] });
  assert.equal(texto.includes('"id"'), false);
});

test('SQL com qualquer coisa dentro sobrevive à ida e à volta', () => {
  // É a razão de o formato ser JSON: um caderno de SQL contém SQL arbitrário,
  // e qualquer separador escolhido poderia aparecer dentro de um bloco.
  const hostil = "SELECT '---', '```', '\\n-- celula', \"}\";";
  const lido = lerCaderno(escreverCaderno({ celulas: [{ id: 'c0', tipo: 'sql', conteudo: hostil }] }));
  assert.equal(lido.celulas[0]?.conteudo, hostil);
});

// ---------------------------------------------------------------------------
// Tolerância — arquivo do usuário nunca derruba a IDE
// ---------------------------------------------------------------------------

test('arquivo que não é JSON vira caderno vazio, sem lançar', () => {
  for (const lixo of ['', 'SELECT 1', '{', 'null', '[]', '"texto"']) {
    assert.deepEqual(lerCaderno(lixo).celulas, [], JSON.stringify(lixo));
  }
});

test('bloco estragado é descartado, e os vizinhos sobrevivem', () => {
  const texto = doJson({
    celulas: [
      { tipo: 'sql', conteudo: 'bom' },
      { tipo: 'inventado', conteudo: 'x' },
      { tipo: 'sql' },
      { conteudo: 'sem tipo' },
      null,
      { tipo: 'markdown', conteudo: 'também bom' },
    ],
  });
  assert.deepEqual(
    lerCaderno(texto).celulas.map((c) => c.conteudo),
    ['bom', 'também bom']
  );
});

test('ids repetidos no arquivo NÃO chegam repetidos ao caderno', () => {
  // Dois blocos com o mesmo id fariam o React confundir um com o outro.
  const texto = doJson({
    celulas: [
      { id: 'x', tipo: 'sql', conteudo: 'a' },
      { id: 'x', tipo: 'sql', conteudo: 'b' },
    ],
  });
  const ids = lerCaderno(texto).celulas.map((c) => c.id);
  assert.equal(new Set(ids).size, 2);
});

test('bloco vazio é preservado — vazio não é estragado', () => {
  const lido = lerCaderno(doJson({ celulas: [{ tipo: 'sql', conteudo: '' }] }));
  assert.equal(lido.celulas.length, 1);
});

// ---------------------------------------------------------------------------
// Mexer nos blocos
// ---------------------------------------------------------------------------

const tres = {
  celulas: [
    { id: 'a', tipo: 'sql' as const, conteudo: '1' },
    { id: 'b', tipo: 'sql' as const, conteudo: '2' },
    { id: 'c', tipo: 'sql' as const, conteudo: '3' },
  ],
};

test('acrescentar no fim e no meio', () => {
  assert.equal(acrescentar(tres, 'sql', -1, 9).celulas[3]?.id, 'c9');
  const meio = acrescentar(tres, 'markdown', 0, 9);
  assert.deepEqual(meio.celulas.map((c) => c.id), ['a', 'c9', 'b', 'c']);
});

test('alterar mexe só no bloco pedido', () => {
  const r = alterar(tres, 'b', 'novo');
  assert.deepEqual(r.celulas.map((c) => c.conteudo), ['1', 'novo', '3']);
});

test('remover tira só o pedido', () => {
  assert.deepEqual(remover(tres, 'b').celulas.map((c) => c.id), ['a', 'c']);
});

test('mover troca com o vizinho', () => {
  assert.deepEqual(mover(tres, 'b', -1).celulas.map((c) => c.id), ['b', 'a', 'c']);
  assert.deepEqual(mover(tres, 'b', 1).celulas.map((c) => c.id), ['a', 'c', 'b']);
});

test('mover nas pontas não faz nada, e NÃO embrulha', () => {
  // Embrulhar para o outro extremo seria uma surpresa desagradável.
  assert.deepEqual(mover(tres, 'a', -1).celulas.map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(mover(tres, 'c', 1).celulas.map((c) => c.id), ['a', 'b', 'c']);
});

test('mexer num id que não existe devolve o caderno como estava', () => {
  assert.deepEqual(mover(tres, 'zzz', 1), tres);
  assert.deepEqual(remover(tres, 'zzz').celulas.length, 3);
});

// ---------------------------------------------------------------------------
// O que o `Run All` roda
// ---------------------------------------------------------------------------

test('o Run All pula markdown e blocos vazios', () => {
  const misto = {
    celulas: [
      { id: 'a', tipo: 'markdown' as const, conteudo: '# título' },
      { id: 'b', tipo: 'sql' as const, conteudo: 'SELECT 1' },
      { id: 'c', tipo: 'sql' as const, conteudo: '   ' },
      { id: 'd', tipo: 'sql' as const, conteudo: 'SELECT 2' },
    ],
  };
  assert.deepEqual(blocosExecutaveis(misto).map((c) => c.id), ['b', 'd']);
});

test('o Run All mantém a ORDEM dos blocos', () => {
  // Um caderno é uma sequência: o bloco 5 costuma depender do 4.
  assert.deepEqual(blocosExecutaveis(tres).map((c) => c.conteudo), ['1', '2', '3']);
});
