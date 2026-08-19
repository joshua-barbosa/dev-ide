import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conciliar, normalizarSessao, SESSAO_VAZIA } from '../sessao-abas';
import { LAYOUT_INICIAL, type NoDeLayout } from '../layout-editor';

const DIVIDIDO: NoDeLayout = {
  tipo: 'divisao',
  orientacao: 'horizontal',
  filhos: [
    { tipo: 'grupo', grupo: 0 },
    { tipo: 'grupo', grupo: 1 },
  ],
};

const CHEIA = {
  pasta: '/projeto',
  abas: [
    { caminho: '/projeto/a.ts', grupo: 0 },
    { caminho: '/projeto/b.ts', grupo: 1 },
  ],
  ativas: { '0': '/projeto/a.ts', '1': '/projeto/b.ts' },
  grupoFocado: 1,
  layout: DIVIDIDO,
};

// ---------------------------------------------------------------------------
// Leitura tolerante
// ---------------------------------------------------------------------------

test('lê de volta o que foi guardado', () => {
  assert.deepEqual(normalizarSessao(JSON.parse(JSON.stringify(CHEIA))), CHEIA);
});

test('qualquer lixo vale como sessão vazia', () => {
  for (const bruto of [null, 3, 'abas', [], {}, { pasta: '' }, { pasta: '/p' }]) {
    assert.deepEqual(normalizarSessao(bruto), SESSAO_VAZIA, `falhou para ${JSON.stringify(bruto)}`);
  }
});

test('aba sem caminho é descartada, e o resto sobrevive', () => {
  const s = normalizarSessao({
    ...CHEIA,
    abas: [{ grupo: 0 }, { caminho: '', grupo: 0 }, { caminho: '/projeto/a.ts', grupo: 0 }],
  });
  assert.deepEqual(s.abas, [{ caminho: '/projeto/a.ts', grupo: 0 }]);
});

test('a mesma aba duas vezes vira uma', () => {
  const s = normalizarSessao({
    ...CHEIA,
    abas: [
      { caminho: '/projeto/a.ts', grupo: 0 },
      { caminho: '/projeto/a.ts', grupo: 1 },
    ],
  });
  assert.equal(s.abas.length, 1, 'o store não deixaria duas abas do mesmo arquivo');
});

test('grupo estragado vira o grupo zero', () => {
  const s = normalizarSessao({ ...CHEIA, abas: [{ caminho: '/projeto/a.ts', grupo: -2 }] });
  assert.equal(s.abas[0]?.grupo, 0);
});

test('ativa apontando para aba que não foi guardada é descartada', () => {
  const s = normalizarSessao({ ...CHEIA, ativas: { '0': '/projeto/sumiu.ts' } });
  assert.deepEqual(s.ativas, {}, 'seria uma referência a nada');
});

test('arranjo estragado vira o arranjo inicial', () => {
  const s = normalizarSessao({ ...CHEIA, layout: { tipo: 'divisao', filhos: 'nada' } });
  assert.deepEqual(s.layout, LAYOUT_INICIAL);
});

test('divisão com um filho só deixa de ser divisão', () => {
  const s = normalizarSessao({
    ...CHEIA,
    layout: { tipo: 'divisao', orientacao: 'horizontal', filhos: [{ tipo: 'grupo', grupo: 3 }] },
  });
  assert.deepEqual(s.layout, { tipo: 'grupo', grupo: 3 });
});

test('foco em grupo que não está no arranjo cai no primeiro', () => {
  const s = normalizarSessao({ ...CHEIA, grupoFocado: 9 });
  assert.equal(s.grupoFocado, 0);
});

// ---------------------------------------------------------------------------
// Conciliação com o disco
// ---------------------------------------------------------------------------

test('arquivo apagado com a IDE fechada some da sessão', () => {
  const s = conciliar(CHEIA, new Set(['/projeto/a.ts']));
  assert.deepEqual(s.abas, [{ caminho: '/projeto/a.ts', grupo: 0 }]);
});

test('...e o lado que ficou sem aba some do arranjo', () => {
  // Sem isto a IDE abriria com metade da tela em branco e sem forma de fechá-la.
  const s = conciliar(CHEIA, new Set(['/projeto/a.ts']));
  assert.deepEqual(s.layout, { tipo: 'grupo', grupo: 0 });
  assert.deepEqual(s.ativas, { '0': '/projeto/a.ts' });
  assert.equal(s.grupoFocado, 0, 'o foco estava no lado que sumiu');
});

test('todos os arquivos apagados devolvem sessão vazia', () => {
  assert.deepEqual(conciliar(CHEIA, new Set()), SESSAO_VAZIA);
});

test('aba num grupo fora do arranjo é trazida para o primeiro', () => {
  const torta = { ...CHEIA, layout: LAYOUT_INICIAL };
  const s = conciliar(torta, new Set(['/projeto/a.ts', '/projeto/b.ts']));
  assert.deepEqual(
    s.abas.map((a) => a.grupo),
    [0, 0],
    'grupo sem lugar no arranjo não teria editor'
  );
});

test('a conciliação não inventa aba nem grupo', () => {
  const s = conciliar(CHEIA, new Set(['/projeto/a.ts', '/projeto/b.ts']));
  assert.deepEqual(s, CHEIA);
});
