import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehTema, NOMES_DE_TEMA, ROTULO_DO_TEMA, TEMAS, type Paleta } from '../temas';

const CHAVES_DE_COR: readonly (keyof Paleta)[] = [
  'bg', 'bgPanel', 'bgEditor', 'border', 'fg', 'fgDim', 'accent', 'run', 'error',
  'selecao', 'selecaoFraca',
];

test('há dois temas, e ambos têm rótulo', () => {
  assert.deepEqual([...NOMES_DE_TEMA].sort(), ['claro', 'escuro']);
  for (const nome of NOMES_DE_TEMA) assert.ok(ROTULO_DO_TEMA[nome].length > 0);
});

test('toda cor da moldura é um hexadecimal com #', () => {
  for (const nome of NOMES_DE_TEMA) {
    for (const chave of CHAVES_DE_COR) {
      assert.match(TEMAS[nome][chave] as string, /^#[0-9a-f]{6}$/, `${nome}.${String(chave)}`);
    }
  }
});

test('as cores de sintaxe vão SEM "#" — é o formato do Monaco', () => {
  // Trocar o formato aqui não quebra o build, só faz o realce sumir em silêncio.
  for (const nome of NOMES_DE_TEMA) {
    for (const [chave, valor] of Object.entries(TEMAS[nome].sintaxe)) {
      assert.match(valor, /^[0-9a-f]{6}$/, `${nome}.sintaxe.${chave}`);
    }
  }
});

test('os dois temas declaram as mesmas 16 cores ANSI, todas com #', () => {
  // Sem elas, o tema claro entrega um terminal com metade do texto invisível:
  // o shell colore supondo fundo escuro.
  assert.equal(Object.keys(TEMAS.escuro.ansi).length, 16);
  assert.deepEqual(Object.keys(TEMAS.escuro.ansi).sort(), Object.keys(TEMAS.claro.ansi).sort());
  for (const nome of NOMES_DE_TEMA) {
    for (const [chave, valor] of Object.entries(TEMAS[nome].ansi)) {
      assert.match(valor, /^#[0-9a-f]{6}$/, `${nome}.ansi.${chave}`);
    }
  }
});

test('as cores ANSI do tema claro são escuras o bastante para se ver no branco', () => {
  const luminancia = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  };
  for (const [chave, valor] of Object.entries(TEMAS.claro.ansi)) {
    if (chave === 'brightWhite' || chave === 'white') continue;
    assert.ok(luminancia(valor) < 160, `${chave} clara demais para fundo branco`);
  }
});

test('os dois temas declaram exatamente as mesmas chaves de sintaxe', () => {
  assert.deepEqual(
    Object.keys(TEMAS.escuro.sintaxe).sort(),
    Object.keys(TEMAS.claro.sintaxe).sort()
  );
});

test('o tema claro é claro e o escuro é escuro', () => {
  // Afirmação boba? Não: inverter uma linha ao copiar a tabela é o erro mais
  // provável aqui, e ele não quebra nada — só entrega texto branco no branco.
  const luminancia = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  };
  assert.ok(luminancia(TEMAS.claro.bgEditor) > 200, 'fundo claro precisa ser claro');
  assert.ok(luminancia(TEMAS.escuro.bgEditor) < 60, 'fundo escuro precisa ser escuro');
  assert.ok(luminancia(TEMAS.claro.fg) < 80, 'o texto do tema claro precisa ser escuro');
  assert.ok(luminancia(TEMAS.escuro.fg) > 180, 'o texto do tema escuro precisa ser claro');
});

test('ehTema reconhece só o que existe', () => {
  assert.equal(ehTema('escuro'), true);
  assert.equal(ehTema('claro'), true);
  assert.equal(ehTema('solarized'), false);
});
