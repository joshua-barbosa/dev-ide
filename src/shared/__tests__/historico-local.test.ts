// O histórico local: o Timeline e o rascunho (T010, T035).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chaveDoArquivo, POLITICA_PADRAO, podar, quandoEmPalavras, tamanhoEmPalavras, valeGuardar,
  type VersaoLocal,
} from '../historico-local';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 1, 12, 0, 0);

const v = (
  id: string,
  diasAtras: number,
  origem: VersaoLocal['origem'] = 'salvo'
): VersaoLocal => ({ id, quando: AGORA - diasAtras * DIA, origem, bytes: 10 });

// ---------------------------------------------------------------------------
// O que vale guardar
// ---------------------------------------------------------------------------

test('salvar sem mudar nada NÃO cria versão nova', () => {
  // Cinco saves sem mudança encheriam o Timeline de linhas iguais, e a versão
  // que interessa — a de antes da mudança — sairia pelo corte.
  assert.equal(valeGuardar('igual', { conteudo: 'igual' }, 'salvo'), false);
  assert.equal(valeGuardar('mudou', { conteudo: 'igual' }, 'salvo'), true);
});

test('o primeiro save sempre entra', () => {
  assert.equal(valeGuardar('qualquer', null, 'salvo'), true);
});

test('o RASCUNHO entra mesmo idêntico ao que já está lá', () => {
  // Ele não diz "o texto mudou", e sim "havia trabalho não salvo quando a
  // janela fechou". Essa informação some se a comparação o barrar.
  assert.equal(valeGuardar('igual', { conteudo: 'igual' }, 'rascunho'), true);
});

test('arquivo grande demais não vira versão', () => {
  // O teto é o mesmo que a IDE usa para ABRIR um arquivo: guardar versão do que
  // ela nem abre não serviria para nada.
  const gordo = 'x'.repeat(POLITICA_PADRAO.maxBytes + 1);
  assert.equal(valeGuardar(gordo, null, 'salvo'), false);
  assert.equal(valeGuardar(gordo, null, 'rascunho'), false);
});

// ---------------------------------------------------------------------------
// A poda
// ---------------------------------------------------------------------------

test('a poda tira o que passou da idade', () => {
  const ficam = podar([v('novo', 1), v('velho', 40)], AGORA);
  assert.deepEqual(ficam.map((x) => x.id), ['novo']);
});

test('a poda tira o que passou do número, guardando as mais NOVAS', () => {
  const muitas = Array.from({ length: 60 }, (_, i) => v(`v${i}`, i / 24));
  const ficam = podar(muitas, AGORA);
  assert.equal(ficam.length, POLITICA_PADRAO.maxPorArquivo);
  assert.equal(ficam[0]?.id, 'v0', 'a mais nova sobrevive');
  assert.equal(ficam.at(-1)?.id, `v${POLITICA_PADRAO.maxPorArquivo - 1}`);
});

test('o RASCUNHO nunca é podado por idade', () => {
  // Ele é trabalho que ninguém salvou. Apagá-lo por ter trinta dias seria jogar
  // fora exatamente o que este item existe para guardar.
  const ficam = podar([v('antigo-rascunho', 400, 'rascunho'), v('velho', 40)], AGORA);
  assert.deepEqual(ficam.map((x) => x.id), ['antigo-rascunho']);
});

test('o rascunho não ocupa vaga das salvas', () => {
  const muitas = Array.from({ length: 60 }, (_, i) => v(`v${i}`, i / 24));
  const ficam = podar([v('r', 0.1, 'rascunho'), ...muitas], AGORA);
  assert.equal(ficam.filter((x) => x.origem === 'salvo').length, POLITICA_PADRAO.maxPorArquivo);
  assert.equal(ficam.filter((x) => x.origem === 'rascunho').length, 1);
});

test('a poda devolve da mais NOVA para a mais velha', () => {
  const ficam = podar([v('b', 2), v('a', 1), v('c', 3)], AGORA);
  assert.deepEqual(ficam.map((x) => x.id), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// A chave
// ---------------------------------------------------------------------------

test('caminhos diferentes dão chaves diferentes — inclusive os parecidos', () => {
  // Trocar `/` por `_` juntaria estes dois na mesma pasta, e um arquivo
  // herdaria o histórico do outro.
  assert.notEqual(chaveDoArquivo('/casa/a/b.ts'), chaveDoArquivo('/casa/a_b.ts'));
  assert.notEqual(chaveDoArquivo('/a/b'), chaveDoArquivo('/a/c'));
});

test('a chave é estável e serve como nome de arquivo', () => {
  const c = chaveDoArquivo('/casa/projeto/src/index.ts');
  assert.equal(c, chaveDoArquivo('/casa/projeto/src/index.ts'));
  assert.match(c, /^[0-9a-f]{16}$/);
});

test('acento no caminho não quebra a chave', () => {
  assert.match(chaveDoArquivo('/casa/coração/ação.ts'), /^[0-9a-f]{16}$/);
});

// ---------------------------------------------------------------------------
// O texto da tela
// ---------------------------------------------------------------------------

test('o tempo é dito como se fala', () => {
  assert.equal(quandoEmPalavras(AGORA - 30_000, AGORA), 'agora há pouco');
  assert.equal(quandoEmPalavras(AGORA - 5 * 60_000, AGORA), 'há 5 min');
  assert.equal(quandoEmPalavras(AGORA - 3 * 60 * 60_000, AGORA), 'há 3 h');
  assert.equal(quandoEmPalavras(AGORA - DIA, AGORA), 'ontem');
  assert.equal(quandoEmPalavras(AGORA - 3 * DIA, AGORA), 'há 3 dias');
  // Passando da semana, a data — "há 23 dias" não ajuda ninguém a se localizar.
  assert.match(quandoEmPalavras(AGORA - 30 * DIA, AGORA), /^\d{2}\/\d{2}$/);
});

test('o futuro não vira número negativo', () => {
  // Relógio do sistema que anda para trás é o caso; "há -4 min" seria um bug à
  // vista de todos.
  assert.equal(quandoEmPalavras(AGORA + 60_000, AGORA), 'agora há pouco');
});

test('o tamanho é dito na unidade que cabe', () => {
  assert.equal(tamanhoEmPalavras(340), '340 B');
  assert.equal(tamanhoEmPalavras(2048), '2.0 KB');
  assert.equal(tamanhoEmPalavras(3 * 1024 * 1024), '3.0 MB');
});
