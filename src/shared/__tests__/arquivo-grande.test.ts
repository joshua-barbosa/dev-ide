// Abrir arquivo grande sem travar, em vez de recusar (spec 091).
//
// O limite de 2 MB não protegia de nada: ele simplesmente não abria. Quem
// precisa olhar um dump ou um log ficava sem editor E sem alternativa.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIMIAR_DE_ARQUIVO_GRANDE, MAX_BYTES_NO_EDITOR, ehArquivoGrande,
  mensagemDeArquivoEnorme, opcoesParaTamanho,
} from '../arquivo-grande';

const MB = 1024 * 1024;

test('o que é grande, e o que é grande demais', () => {
  assert.equal(ehArquivoGrande(500 * 1024), false);
  assert.equal(ehArquivoGrande(LIMIAR_DE_ARQUIVO_GRANDE + 1), true);
  // O teto de recusa está MUITO acima do limiar: entre um e outro, o arquivo
  // abre — com menos recursos, e não com menos honestidade.
  assert.ok(MAX_BYTES_NO_EDITOR > LIMIAR_DE_ARQUIVO_GRANDE * 8);
});

test('arquivo comum abre com tudo ligado', () => {
  const o = opcoesParaTamanho(100 * 1024);
  assert.equal(o.minimap.enabled, true);
  assert.equal(o.folding, true);
  assert.equal(o.wordBasedSuggestions, 'currentDocument');
});

test('arquivo grande abre com o que custa caro DESLIGADO', () => {
  const o = opcoesParaTamanho(20 * MB);
  // Cada um destes percorre o arquivo inteiro a cada toque de tecla.
  assert.equal(o.minimap.enabled, false);
  assert.equal(o.folding, false);
  assert.equal(o.wordBasedSuggestions, 'off');
  assert.equal(o.occurrencesHighlight, 'off');
  assert.equal(o.renderWhitespace, 'none');
  // Quebrar linha num arquivo de milhões de colunas é o pior caso do Monaco.
  assert.equal(o.wordWrap, 'off');
});

test('a recusa diz o tamanho e o que fazer, em vez de só um número', () => {
  const m = mensagemDeArquivoEnorme(120 * MB);
  assert.match(m, /120/);
  assert.match(m, /MB/);
  // Sem saída, a mensagem é um beco. Com saída, é uma instrução.
  assert.match(m, /terminal/i);
});
