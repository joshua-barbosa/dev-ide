import assert from 'node:assert/strict';
import test from 'node:test';
import {
  foiMexida, FONTE_MAXIMA, FONTE_MINIMA, HERDA_TUDO, resolverAparencia,
  SCROLLBACK_MAXIMO, SCROLLBACK_MINIMO,
} from '../terminal/aparencia';

test('sem nada na aba, tudo vem do config.json', () => {
  // É o que impede a "segunda verdade": quem não mexe não tem preferência
  // própria nenhuma.
  const r = resolverAparencia(HERDA_TUDO, { fontSize: 13 });
  assert.equal(r.fontSize, 13);
});

test('o que a aba diz ganha do padrão', () => {
  assert.equal(resolverAparencia({ fontSize: 18 }, { fontSize: 13 }).fontSize, 18);
});

test('a fonte tem parede dos dois lados', () => {
  assert.equal(resolverAparencia({ fontSize: 2 }, { fontSize: 13 }).fontSize, FONTE_MINIMA);
  assert.equal(resolverAparencia({ fontSize: 900 }, { fontSize: 13 }).fontSize, FONTE_MAXIMA);
});

test('o padrão do config.json TAMBÉM é aparado', () => {
  // Ele vem de um arquivo que o usuário edita à mão; um `0` ali não pode virar
  // um terminal invisível.
  assert.equal(resolverAparencia(HERDA_TUDO, { fontSize: 0 }).fontSize, FONTE_MINIMA);
});

test('o scrollback tem teto: o buffer é memória da aba', () => {
  assert.equal(resolverAparencia({ scrollback: 1 }, { fontSize: 13 }).scrollback, SCROLLBACK_MINIMO);
  assert.equal(
    resolverAparencia({ scrollback: 10_000_000 }, { fontSize: 13 }).scrollback,
    SCROLLBACK_MAXIMO
  );
});

test('cursor: os padrões são os do xterm', () => {
  const r = resolverAparencia(HERDA_TUDO, { fontSize: 13 });
  assert.equal(r.cursorBlink, true);
  assert.equal(r.cursorStyle, 'block');
});

test('`cursorBlink: false` é respeitado — e não confundido com ausente', () => {
  // O erro clássico do `??` com booleano: `false || true` daria `true`.
  assert.equal(resolverAparencia({ cursorBlink: false }, { fontSize: 13 }).cursorBlink, false);
});

test('foiMexida distingue "não mexi" de "pus o mesmo valor"', () => {
  assert.equal(foiMexida(HERDA_TUDO), false);
  assert.equal(foiMexida({ fontSize: 13 }), true);
  // Mesmo igual ao padrão, foi uma escolha — e a marca diz que existe escolha.
  assert.equal(foiMexida({ cursorBlink: true }), true);
});
