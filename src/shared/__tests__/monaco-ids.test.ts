import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idDoMonaco, LINGUAGENS_DO_MONACO } from '../editor/monaco-ids';
import { LINGUAGENS } from '../editor/idiomas';
import { EXT_TO_LANG } from '../editor/languages';
import { ACAO_DO_MONACO } from '../editor/acoes-monaco';
import { ATENDIDOS_PELO_EDITOR } from '../commands';

test('as linguagens do seletor têm tradução', () => {
  for (const [nossa] of LINGUAGENS) {
    // `plain` é a exceção legítima: ele DEVE virar `plaintext`. Cair nele por
    // ausência do mapa é que seria defeito — coberto pelo teste seguinte.
    if (nossa === 'plain') continue;
    assert.notEqual(
      idDoMonaco(nossa),
      'plaintext',
      `"${nossa}" caiu em texto puro — falta no mapa`
    );
  }
});

test('as cinco acrescentadas na spec 010 também têm', () => {
  for (const nossa of ['yaml', 'markdown', 'shell', 'xml', 'dockerfile']) {
    assert.notEqual(idDoMonaco(nossa), 'plaintext', `"${nossa}" sem tradução`);
  }
});

test('nome desconhecido cai em texto puro, e não quebra', () => {
  assert.equal(idDoMonaco('klingon'), 'plaintext');
  assert.equal(idDoMonaco(''), 'plaintext');
});

test('"plain" é traduzido, e não passa cru', () => {
  // Esta é a que erra na prática: o nome é parecido, mas não é o mesmo.
  assert.equal(idDoMonaco('plain'), 'plaintext');
});

test('toda linguagem que uma extensão produz tem tradução', () => {
  // Sem isto, acrescentar uma extensão nova ao EXT_TO_LANG e esquecer o mapa
  // faria o arquivo abrir sem realce, em silêncio.
  for (const nossa of new Set(Object.values(EXT_TO_LANG))) {
    if (nossa === 'plain') continue;
    assert.notEqual(
      idDoMonaco(nossa),
      'plaintext',
      `a extensão que gera "${nossa}" abriria sem realce`
    );
  }
});

test('a lista para o build não tem repetição', () => {
  assert.equal(new Set(LINGUAGENS_DO_MONACO).size, LINGUAGENS_DO_MONACO.length);
});

test('o mapa de ações do editor cobre exatamente os comandos atendidos', () => {
  // As duas listas moram em arquivos diferentes (uma em shared, outra na
  // interface, porque só ela conhece o Monaco). Divergirem em silêncio é o
  // risco; este teste é a costura.
  const semAcao = [...ATENDIDOS_PELO_EDITOR].filter((id) => ACAO_DO_MONACO[id] === undefined);
  assert.deepEqual(semAcao, [], 'comandos declarados como do editor, sem ação do Monaco');

  const sobrando = Object.keys(ACAO_DO_MONACO).filter((id) => !ATENDIDOS_PELO_EDITOR.has(id));
  assert.deepEqual(sobrando, [], 'ações do Monaco para comandos que não estão declarados');
});
