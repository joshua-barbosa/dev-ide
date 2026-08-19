import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarNoConteudo, escaparRegex, MAX_TERMO, montarRegex, ocorrenciasNaLinha, OPCOES_PADRAO,
  pareceBinario, substituirNaLinha, substituirNoConteudo,
} from '../busca';

const re = (termo: string, opcoes = {}): RegExp => {
  const r = montarRegex(termo, { ...OPCOES_PADRAO, ...opcoes });
  if (r === null) throw new Error(`termo recusado: ${termo}`);
  return r;
};

// ---------------------------------------------------------------------------
// Montar a expressão
// ---------------------------------------------------------------------------

test('busca literal escapa o que é especial na regex', () => {
  // Procurar por `a.b` não pode casar `axb`.
  assert.equal(re('a.b').test('axb'), false);
  assert.equal(re('a.b').test('a.b'), true);
});

test('modo regex usa o termo como está', () => {
  assert.equal(re('a.b', { regex: true }).test('axb'), true);
});

test('por padrão não diferencia maiúsculas', () => {
  assert.equal(re('CASA').test('minha casa'), true);
  assert.equal(re('CASA', { maiusculas: true }).test('minha casa'), false);
});

test('palavra inteira não casa pedaço de palavra', () => {
  const r = re('casa', { palavraInteira: true });
  assert.equal(r.test('a casa é azul'), true);
  r.lastIndex = 0;
  assert.equal(r.test('casamento'), false);
});

test('palavra inteira com termo que começa em pontuação AINDA casa', () => {
  // `\b` é fronteira entre palavra e não-palavra: pô-la ao lado de `(` exigiria
  // uma palavra colada no parêntese, e a busca nunca casaria.
  assert.equal(re('(x)', { palavraInteira: true }).test('f(x)'), true);
  // O cifrão NÃO é caractere de palavra para o motor de regex. Tratá-lo como se
  // fosse punha a borda onde ela não casa, e `$id` não achava nada.
  assert.equal(re('$id', { palavraInteira: true }).test('echo $id'), true);
  assert.equal(re('$id', { palavraInteira: true }).test('echo $idade'), false);
});

test('termo vazio e regex inválida devolvem null, sem lançar', () => {
  // São coisas que se digita o tempo todo enquanto se pensa.
  assert.equal(montarRegex('', OPCOES_PADRAO), null);
  assert.equal(montarRegex('[', { ...OPCOES_PADRAO, regex: true }), null);
  assert.equal(montarRegex('(', { ...OPCOES_PADRAO, regex: true }), null);
});

test('termo absurdamente longo é recusado', () => {
  assert.equal(montarRegex('a'.repeat(MAX_TERMO + 1), OPCOES_PADRAO), null);
});

test('escaparRegex cobre os metacaracteres', () => {
  assert.equal(escaparRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o'),
    'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o');
});

// ---------------------------------------------------------------------------
// Achar
// ---------------------------------------------------------------------------

test('acha todas as ocorrências da linha, com coluna a partir de 1', () => {
  const achadas = ocorrenciasNaLinha('foo bar foo', 7, re('foo'));
  assert.deepEqual(achadas.map((o) => [o.linha, o.coluna, o.colunaFim]), [[7, 1, 4], [7, 9, 12]]);
  assert.equal(achadas[0]?.texto, 'foo bar foo');
});

test('CASAMENTO DE TAMANHO ZERO não trava o laço', () => {
  // `a*` e `^` casam sem consumir, e `lastIndex` não anda sozinho: sem empurrá-lo
  // à mão, `exec` devolve o mesmo índice para sempre e a aba congela. Não é
  // hipótese — é o que acontece na primeira vez que alguém procura por `^`.
  const porCircunflexo = ocorrenciasNaLinha('abc', 1, re('^', { regex: true }));
  assert.equal(porCircunflexo.length, 1);

  const porEstrela = ocorrenciasNaLinha('abc', 1, re('x*', { regex: true }));
  assert.ok(porEstrela.length <= 4, 'não pode explodir');
});

test('o limite por linha é respeitado', () => {
  const achadas = ocorrenciasNaLinha('aaaaaaaaaa', 1, re('a'), 3);
  assert.equal(achadas.length, 3);
});

test('busca no conteúdo numera as linhas a partir de 1', () => {
  const achadas = buscarNoConteudo('um\ndois\ntres dois', re('dois'));
  assert.deepEqual(achadas.map((o) => o.linha), [2, 3]);
});

test('arquivo binário é ignorado', () => {
  assert.equal(buscarNoConteudo(`bin\u0000ario com termo`, re('termo')).length, 0);
});

test('pareceBinario aceita tabulação, quebra e retorno', () => {
  assert.equal(pareceBinario('a\tb\nc\r\nd'), false);
  assert.equal(pareceBinario('a\u0000b'), true);
  assert.equal(pareceBinario('a\u0007b'), true);
});

test('o limite por arquivo corta, e não estoura', () => {
  const conteudo = Array.from({ length: 50 }, () => 'alvo alvo').join('\n');
  assert.equal(buscarNoConteudo(conteudo, re('alvo'), 10).length, 10);
});

// ---------------------------------------------------------------------------
// Substituir
// ---------------------------------------------------------------------------

test('substituição literal troca o texto', () => {
  assert.equal(substituirNaLinha('a foo b', re('foo'), 'bar', false), 'a bar b');
});

test('O CIFRÃO NA BUSCA LITERAL é texto, não referência de grupo', () => {
  // Para o `String.replace`, `$1` é o primeiro grupo. Em busca literal, quem
  // digitou `US$1` espera `US$1` — e receberia o grupo, ou vazio, em silêncio.
  assert.equal(substituirNaLinha('preco: X', re('X'), 'US$1', false), 'preco: US$1');
  assert.equal(substituirNaLinha('a X b', re('X'), '$&', false), 'a $& b');
});

test('em MODO REGEX o cifrão referencia grupo, que é o que se quer', () => {
  const r = re('(\\w+)@(\\w+)', { regex: true });
  assert.equal(substituirNaLinha('joao@exemplo', r, '$2/$1', true), 'exemplo/joao');
});

test('substituir no conteúdo devolve o texto e a contagem', () => {
  const { texto, trocas } = substituirNoConteudo('foo\nbar\nfoo', re('foo'), 'X', false);
  assert.equal(texto, 'X\nbar\nX');
  assert.equal(trocas, 2);
});

test('sem ocorrência, o conteúdo volta idêntico e sem troca', () => {
  const original = 'nada aqui';
  const { texto, trocas } = substituirNoConteudo(original, re('zzz'), 'X', false);
  assert.equal(texto, original);
  assert.equal(trocas, 0);
});

test('`^` e `$` valem por LINHA, e não pelo arquivo inteiro', () => {
  // É o que o usuário vê na tela, e o que o resultado da busca mostrou a ele.
  const { texto, trocas } = substituirNoConteudo(
    'um\ndois',
    re('^', { regex: true }),
    '> ',
    true
  );
  assert.equal(texto, '> um\n> dois');
  assert.equal(trocas, 2);
});

test('arquivo binário não é modificado', () => {
  const original = `bin\u0000ario alvo`;
  const { texto, trocas } = substituirNoConteudo(original, re('alvo'), 'X', false);
  assert.equal(texto, original);
  assert.equal(trocas, 0);
});

test('a quebra de linha final sobrevive à substituição', () => {
  const { texto } = substituirNoConteudo('foo\n', re('foo'), 'bar', false);
  assert.equal(texto, 'bar\n', 'perder a linha em branco final sujaria todo diff');
});
