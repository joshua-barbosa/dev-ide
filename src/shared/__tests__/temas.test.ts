import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  definirTemasDoUsuario, ehTema, nomesDeTema, normalizarTemasDoUsuario, paletaDe, resolverTema,
  type Paleta,
} from '../temas';
import { ROTULO_DO_TEMA, TEMAS, TEMAS_CLAROS, type TemaEmbutido } from '../temas-embutidos';

const NOMES = Object.keys(TEMAS) as readonly TemaEmbutido[];

const CHAVES_DE_COR: readonly (keyof Paleta)[] = [
  'bg', 'bgPanel', 'bgEditor', 'border', 'fg', 'fgDim', 'accent', 'run', 'error',
  'selecao', 'selecaoFraca',
];

test('todo tema embutido tem rótulo', () => {
  assert.deepEqual(
    [...NOMES].sort(),
    ['alto-contraste', 'claro', 'dracula', 'escuro', 'github-claro', 'nord', 'one-dark',
      'solarized-claro', 'solarized-escuro']
  );
  for (const nome of NOMES as readonly TemaEmbutido[]) assert.ok(ROTULO_DO_TEMA[nome].length > 0);
});

test('toda cor da moldura é um hexadecimal com #', () => {
  for (const nome of NOMES as readonly TemaEmbutido[]) {
    for (const chave of CHAVES_DE_COR) {
      assert.match(TEMAS[nome][chave] as string, /^#[0-9a-f]{6}$/, `${nome}.${String(chave)}`);
    }
  }
});

test('as cores de sintaxe vão SEM "#" — é o formato do Monaco', () => {
  // Trocar o formato aqui não quebra o build, só faz o realce sumir em silêncio.
  for (const nome of NOMES as readonly TemaEmbutido[]) {
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
  for (const nome of NOMES as readonly TemaEmbutido[]) {
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

// ---------------------------------------------------------------------------
// Tema do usuário (T012)
// ---------------------------------------------------------------------------

const MEU = { meu: { base: 'escuro', cores: { accent: '#123456' } } };

test('o tema do usuário herda tudo o que não declarou', () => {
  const p = resolverTema('meu', TEMAS, MEU);
  assert.ok(p !== null);
  assert.equal(p.accent, '#123456', 'o que ele declarou vale');
  assert.equal(p.bg, TEMAS.escuro.bg, 'o resto vem da base');
  assert.deepEqual(p.ansi, TEMAS.escuro.ansi);
});

test('sem base declarada, a base é o escuro', () => {
  const p = resolverTema('meu', TEMAS, { meu: { cores: { fg: '#ffffff' } } });
  assert.equal(p?.bgEditor, TEMAS.escuro.bgEditor);
});

test('base que não existe também cai no escuro, em vez de sumir', () => {
  const p = resolverTema('meu', TEMAS, { meu: { base: 'inventado', cores: {} } });
  assert.deepEqual(p, TEMAS.escuro);
});

test('herdar de qualquer embutido, e não só do escuro', () => {
  const p = resolverTema('meu', TEMAS, { meu: { base: 'nord', cores: {} } });
  assert.deepEqual(p, TEMAS.nord);
});

test('cor inválida vale como AUSENTE, e não derruba o tema', () => {
  // Um dígito trocado num `config.json` editado à mão não pode deixar a IDE
  // sem tema.
  const p = resolverTema('meu', TEMAS, {
    meu: { base: 'escuro', cores: { accent: '#12345', bg: 'azul', fg: 42, run: '#00ff00' } },
  });
  assert.equal(p?.accent, TEMAS.escuro.accent);
  assert.equal(p?.bg, TEMAS.escuro.bg);
  assert.equal(p?.fg, TEMAS.escuro.fg);
  assert.equal(p?.run, '#00ff00', 'a válida do meio continua valendo');
});

test('a sintaxe entra SEM cerquilha, e o `#` colado é perdoado', () => {
  // Sem `#` é o formato que o Monaco espera; com `#` é o erro que todo mundo
  // comete ao copiar uma cor de outro lugar.
  const p = resolverTema('meu', TEMAS, {
    meu: { base: 'escuro', cores: { sintaxe: { reservada: '#AABBCC', tipo: 'ddeeff' } } },
  });
  assert.equal(p?.sintaxe.reservada, 'aabbcc');
  assert.equal(p?.sintaxe.tipo, 'ddeeff');
  assert.equal(p?.sintaxe.funcao, TEMAS.escuro.sintaxe.funcao, 'o resto herda');
});

test('as 16 cores do terminal também se herdam uma a uma', () => {
  const p = resolverTema('meu', TEMAS, {
    meu: { base: 'escuro', cores: { ansi: { red: '#ff0000' } } },
  });
  assert.equal(p?.ansi.red, '#ff0000');
  assert.equal(p?.ansi.blue, TEMAS.escuro.ansi.blue);
});

test('nome que não é de ninguém devolve null', () => {
  assert.equal(resolverTema('fantasma', TEMAS, MEU), null);
});

test('o embutido vence: ninguém sequestra o nome `escuro`', () => {
  const p = resolverTema('escuro', TEMAS, { escuro: { base: 'claro', cores: {} } });
  assert.deepEqual(p, TEMAS.escuro);
});

// ---- leitura tolerante do config.json ----

test('temas do usuário estragados somem, e os bons ficam', () => {
  const lido = normalizarTemasDoUsuario({
    bom: { base: 'nord', cores: { fg: '#ffffff' } },
    lista: [1, 2],
    texto: 'nada',
    nulo: null,
    '': { cores: {} },
    semCores: { base: 'claro' },
  });
  assert.deepEqual(Object.keys(lido).sort(), ['bom', 'semCores']);
  assert.equal(lido.semCores?.base, 'claro');
  assert.deepEqual(lido.semCores?.cores, {});
});

test('qualquer lixo no lugar do mapa vale como mapa vazio', () => {
  for (const bruto of [null, 7, 'x', [], undefined]) {
    assert.deepEqual(normalizarTemasDoUsuario(bruto), {});
  }
});

// ---- o catálogo vivo ----

test('o catálogo passa a conhecer os temas dele', () => {
  assert.equal(ehTema('meu'), false);
  definirTemasDoUsuario(MEU);
  assert.equal(ehTema('meu'), true);
  assert.ok(nomesDeTema().includes('meu'));
  assert.ok(nomesDeTema().includes('escuro'), 'os embutidos continuam lá');
  assert.equal(paletaDe('meu').accent, '#123456');

  // Nome que não existe cai no escuro: a alternativa seria a tela sem cor.
  assert.deepEqual(paletaDe('fantasma'), TEMAS.escuro);
  definirTemasDoUsuario({});
});

test('cada tema sabe de que LADO está — claro ou escuro (T013)', () => {
  assert.ok(TEMAS_CLAROS.has('claro'));
  assert.ok(TEMAS_CLAROS.has('github-claro'));
  assert.ok(!TEMAS_CLAROS.has('escuro'));
  assert.ok(!TEMAS_CLAROS.has('dracula'));
});
