// Pinecone numa árvore e numa grade.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detalheDoIndice, gradeDaBusca, lerVetor, rotuloDoNamespace,
} from '../sql/pinecone-modelo';

test('o namespace padrão tem nome VAZIO — e vazio na árvore parece defeito', () => {
  assert.equal(rotuloDoNamespace(''), '(padrão)');
  assert.equal(rotuloDoNamespace('producao'), 'producao');
});

test('o detalhe do índice diz dimensão, métrica e quantos', () => {
  assert.equal(
    detalheDoIndice({ nome: 'x', dimensao: 1536, metrica: 'cosine', vetores: 12000 }),
    '1536d · cosine · 12.000'
  );
});

test('a NOTA é a primeira coluna', () => {
  // Sem ela, dez linhas parecem igualmente boas — e não são.
  const r = gradeDaBusca([{ id: 'a', score: 0.9 }]);
  assert.equal(r.colunas[0], 'score');
  assert.equal(r.colunas[1], 'id');
});

test('quatro casas: com duas, vizinhos viram iguais', () => {
  // Distinguir vizinhos é exatamente o uso de uma busca vetorial.
  const r = gradeDaBusca([{ id: 'a', score: 0.91234 }, { id: 'b', score: 0.91236 }]);
  assert.notEqual(r.linhas[0]?.[0], r.linhas[1]?.[0]);
});

test('metadados entram na ordem de aparição', () => {
  const r = gradeDaBusca([
    { id: 'a', score: 1, metadata: { titulo: 't', ano: 2020 } },
    { id: 'b', score: 0.5, metadata: { autor: 'x' } },
  ]);
  assert.deepEqual(r.colunas, ['score', 'id', 'titulo', 'ano', 'autor']);
});

test('metadado ausente vira nulo, e não "undefined"', () => {
  const r = gradeDaBusca([
    { id: 'a', score: 1, metadata: { titulo: 't' } },
    { id: 'b', score: 0.5 },
  ]);
  assert.equal(r.linhas[1]?.[2], null);
});

test('sem metadado nenhum, só score e id', () => {
  assert.deepEqual(gradeDaBusca([{ id: 'a', score: 1 }]).colunas, ['score', 'id']);
});

// ---------------------------------------------------------------------------
// O vetor digitado
// ---------------------------------------------------------------------------

test('dimensão errada diz QUAL era a esperada', () => {
  // O Pinecone recusa com uma mensagem sobre dimensões que não diz a esperada —
  // e essa é justamente a informação que falta.
  const r = lerVetor('[1,2,3]', 1536);
  assert.match('erro' in r ? r.erro : '', /1536 dimensões.*tem 3/s);
});

test('lista com texto dentro é recusada', () => {
  assert.match('erro' in lerVetor('[1,"x"]', 2) ? (lerVetor('[1,"x"]', 2) as { erro: string }).erro : '', /números finitos/);
});

test('NaN e Infinity não passam', () => {
  assert.ok('erro' in lerVetor('[1, null]', 2));
});

test('JSON quebrado explica o formato esperado', () => {
  assert.match('erro' in lerVetor('{1,2}', 2) ? (lerVetor('{1,2}', 2) as { erro: string }).erro : '', /lista JSON/);
});

test('vetor certo passa', () => {
  assert.deepEqual(lerVetor('[0.1, 0.2]', 2), { vetor: [0.1, 0.2] });
});
