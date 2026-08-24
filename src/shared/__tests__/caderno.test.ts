import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inserir,
  alterar,
  blocosExecutaveis,
  escreverCaderno,
  lerCaderno,
  mover,
  remover,
  reordenar,
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

test('inserir conta FRESTAS: 0 é antes do primeiro, n é depois do último', () => {
  // A conta antiga era "depois de qual bloco", e a fresta 0 virava `-1` — que
  // ali queria dizer "no fim". Errava por um caderno inteiro (spec 050).
  assert.deepEqual(inserir(tres, 'sql', 0, 9).celulas.map((c) => c.id), ['c9', 'a', 'b', 'c']);
  assert.deepEqual(inserir(tres, 'sql', 3, 9).celulas.map((c) => c.id), ['a', 'b', 'c', 'c9']);
  assert.deepEqual(
    inserir(tres, 'markdown', 1, 9).celulas.map((c) => c.id),
    ['a', 'c9', 'b', 'c']
  );
});

test('inserir fora da faixa encosta na ponta mais próxima', () => {
  assert.deepEqual(inserir(tres, 'sql', -3, 9).celulas[0]?.id, 'c9');
  assert.deepEqual(inserir(tres, 'sql', 99, 9).celulas[3]?.id, 'c9');
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

// ---------------------------------------------------------------------------
// Reordenar arrastando (spec 050)
// ---------------------------------------------------------------------------

const ids = (c: { celulas: readonly { id: string }[] }): string[] => c.celulas.map((x) => x.id);

test('arrastar para uma fresta adiante desconta a própria saída', () => {
  // A armadilha do arraste: ao tirar `a` da posição 0, tudo acima desce um.
  // A fresta 2 (entre `b` e `c`) tem que continuar sendo entre `b` e `c`.
  assert.deepEqual(ids(reordenar(tres, 'a', 2)), ['b', 'a', 'c']);
});

test('arrastar para o fim e para o começo', () => {
  assert.deepEqual(ids(reordenar(tres, 'a', 3)), ['b', 'c', 'a']);
  assert.deepEqual(ids(reordenar(tres, 'c', 0)), ['c', 'a', 'b']);
});

test('arrastar para uma fresta atrás NÃO desconta', () => {
  assert.deepEqual(ids(reordenar(tres, 'c', 1)), ['a', 'c', 'b']);
});

test('soltar na própria posição devolve o MESMO caderno', () => {
  // Idêntico, e não só igual: é o que impede o arquivo de ser marcado como
  // alterado por um arraste que não mudou nada (AC-11).
  assert.equal(reordenar(tres, 'b', 1), tres);
  assert.equal(reordenar(tres, 'b', 2), tres);
});

test('reordenar com id inexistente ou fresta fora da faixa não estraga nada', () => {
  assert.equal(reordenar(tres, 'zzz', 1), tres);
  assert.deepEqual(ids(reordenar(tres, 'a', 99)), ['b', 'c', 'a']);
  assert.deepEqual(ids(reordenar(tres, 'c', -5)), ['c', 'a', 'b']);
});
