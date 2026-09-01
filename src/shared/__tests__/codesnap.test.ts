// A conta da foto de código (spec 077).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALTURA_DO_ENFEITE, alturaDeLinha, centroDoCirculo, ESTILO_PADRAO, medir, misturarCores,
  nomeDaFoto, semORecuoComum,
} from '../codesnap';

const estilo = { ...ESTILO_PADRAO, numeros: false, enfeiteDeJanela: false };

test('sem números e sem enfeite, a imagem é o texto mais os dois espaços', () => {
  const m = medir(3, 200, 8, estilo);
  assert.equal(m.larguraDosNumeros, 0);
  assert.equal(m.largura, 200 + estilo.recheio * 2 + estilo.moldura * 2);
  assert.equal(
    m.altura,
    3 * estilo.lineHeight + estilo.recheio * 2 + estilo.moldura * 2
  );
  assert.equal(m.codigoX, estilo.moldura + estilo.recheio);
  assert.equal(m.codigoY, estilo.moldura + estilo.recheio);
});

test('o enfeite de janela empurra o código para baixo, e só ele', () => {
  const sem = medir(3, 200, 8, estilo);
  const com = medir(3, 200, 8, { ...estilo, enfeiteDeJanela: true });
  assert.equal(com.altura - sem.altura, ALTURA_DO_ENFEITE);
  assert.equal(com.codigoY - sem.codigoY, ALTURA_DO_ENFEITE);
  assert.equal(com.largura, sem.largura, 'a largura não muda');
});

test('a coluna de números cresce com o NÚMERO da última linha, não com a quantidade', () => {
  // Começando na linha 1, três linhas: um dígito.
  const curta = medir(3, 200, 10, { ...estilo, numeros: true, primeiraLinha: 1 });
  // As mesmas três linhas, mas do meio do arquivo: quatro dígitos.
  const longa = medir(3, 200, 10, { ...estilo, numeros: true, primeiraLinha: 1200 });
  assert.ok(longa.larguraDosNumeros > curta.larguraDosNumeros);
  assert.equal(longa.larguraDosNumeros - curta.larguraDosNumeros, 30, 'três dígitos a mais');
  assert.equal(longa.largura - curta.largura, 30, 'e a imagem acompanha');
});

test('os três círculos ficam lado a lado, na faixa de cima', () => {
  const c = [0, 1, 2].map((i) => centroDoCirculo(i, ESTILO_PADRAO));
  assert.equal(c[1]!.x - c[0]!.x, c[2]!.x - c[1]!.x, 'igualmente espaçados');
  assert.equal(c[0]!.y, c[1]!.y);
  assert.equal(c[0]!.y, ESTILO_PADRAO.moldura + ALTURA_DO_ENFEITE / 2);
});

// ---------------------------------------------------------------------------
// O recuo comum
// ---------------------------------------------------------------------------

test('o recuo que TODAS as linhas têm sai fora', () => {
  assert.equal(
    semORecuoComum('        const a = 1;\n        const b = 2;'),
    'const a = 1;\nconst b = 2;'
  );
});

test('o recuo RELATIVO fica de pé', () => {
  assert.equal(
    semORecuoComum('    if (a) {\n      b();\n    }'),
    'if (a) {\n  b();\n}'
  );
});

test('linha em branco não zera o recuo', () => {
  // Sem esta regra, qualquer linha vazia no meio do trecho faria o recuo comum
  // virar zero e a foto sair com a faixa branca que a função existe para tirar.
  assert.equal(
    semORecuoComum('    a();\n\n    b();'),
    'a();\n\nb();'
  );
});

test('tabulação vira quatro espaços antes da conta', () => {
  assert.equal(semORecuoComum('\ta();\n\tb();'), 'a();\nb();');
});

test('sem recuo comum, nada muda', () => {
  assert.equal(semORecuoComum('a();\n  b();'), 'a();\n  b();');
});

// ---------------------------------------------------------------------------
// O nome do arquivo
// ---------------------------------------------------------------------------

test('o nome leva o arquivo e a linha', () => {
  assert.equal(nomeDaFoto('/casa/projeto/src/useWorkspace.ts', 42), 'useWorkspace-L42.png');
});

test('trecho sem arquivo ainda ganha um nome utilizável', () => {
  assert.equal(nomeDaFoto(null, 1), 'trecho-L1.png');
});

test('nome com caractere estranho não vira caminho nem some', () => {
  assert.equal(nomeDaFoto('/tmp/a b/c#d.sql', 7), 'c-d-L7.png');
  assert.equal(nomeDaFoto('/tmp/###.txt', 3), 'trecho-L3.png');
});

// ---------------------------------------------------------------------------
// A altura de linha e a mistura de cor
// ---------------------------------------------------------------------------

test('a altura de linha é a que o Monaco usaria', () => {
  // 1.35 é a razão do Monaco no Linux e no Windows. Estava fixa em 1.5, e a
  // foto saía mais arejada que o editor — parecida, e não igual.
  assert.equal(alturaDeLinha(14), 19);
  assert.equal(alturaDeLinha(12), 16);
  assert.equal(ESTILO_PADRAO.lineHeight, alturaDeLinha(ESTILO_PADRAO.fontSize));
});

test('misturar cor anda de uma para a outra', () => {
  assert.equal(misturarCores('#000000', '#ffffff', 0), '#000000');
  assert.equal(misturarCores('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(misturarCores('#000000', '#ffffff', 0.5), '#808080');
});

test('a forma curta de três dígitos vale', () => {
  assert.equal(misturarCores('#000', '#fff', 1), '#ffffff');
});

test('cor inválida volta como veio, e não derruba a foto', () => {
  assert.equal(misturarCores('rgb(0,0,0)', '#ffffff', 0.5), 'rgb(0,0,0)');
  assert.equal(misturarCores('#000000', 'azul', 0.5), '#000000');
});
