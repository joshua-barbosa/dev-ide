// O ranking do `Ctrl+P` (T051).
//
// Tudo aqui é aritmética, e por isso está fora do navegador: provar no
// Playwright que `usli` traz `usa-lib.ts` antes de `utils.ts` custaria um teste
// lento para cada caso de borda.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acharArquivos, nomeDe, pontuar, pontuarCaminho } from '../busca-de-arquivo';

test('as letras precisam aparecer NA ORDEM', () => {
  assert.notEqual(pontuar('utils.ts', 'uts'), null);
  assert.equal(pontuar('utils.ts', 'stu'), null, 'fora de ordem não casa');
});

test('letra que não existe não casa', () => {
  assert.equal(pontuar('utils.ts', 'z'), null);
});

test('termo vazio casa com tudo, sem pontuar', () => {
  assert.equal(pontuar('qualquer.ts', ''), 0);
});

test('a busca não diferencia maiúsculas', () => {
  assert.notEqual(pontuar('MeuArquivo.ts', 'meuarq'), null);
  assert.notEqual(pontuar('meuarquivo.ts', 'MEUARQ'), null);
});

test('casar de perto vale mais que casar espalhado', () => {
  const perto = pontuar('config.ts', 'con');
  const longe = pontuar('c-o-n-fig.ts', 'con');
  assert.ok(perto !== null && longe !== null);
  assert.ok(perto > longe, `${perto} deveria passar ${longe}`);
});

test('começo de palavra vale mais que meio de palavra', () => {
  const inicio = pontuar('parse-config.ts', 'pc');
  const meio = pontuar('xparsexconfig.ts', 'pc');
  assert.ok(inicio !== null && meio !== null);
  assert.ok(inicio > meio);
});

test('camelCase conta como começo de palavra', () => {
  // Quem digita `pc` espera achar `parseConfig` tanto quanto `parse_config`.
  assert.ok((pontuar('parseConfig.ts', 'pc') ?? 0) > (pontuar('parsexconfig.ts', 'pc') ?? 0));
});

test('a pontuação nunca fica negativa', () => {
  const p = pontuar(`${'x'.repeat(500)}a`, 'a');
  assert.ok(p !== null && p >= 0);
});

test('o nome sai do caminho', () => {
  assert.equal(nomeDe('/p/src/utils.ts'), 'utils.ts');
  assert.equal(nomeDe('utils.ts'), 'utils.ts');
});

test('casar no NOME vale mais que casar na pasta', () => {
  const noNome = pontuarCaminho('outra/config.ts', 'config');
  const naPasta = pontuarCaminho('config/outra-coisa-bem-longa.ts', 'config');
  assert.ok(noNome !== null && naPasta !== null);
  assert.ok(noNome > naPasta, `${noNome} deveria passar ${naPasta}`);
});

// ---- a lista ----

const ARQUIVOS = [
  'src/utils.ts',
  'src/usa-lib.ts',
  'src/lib.ts',
  'testes/utils.test.ts',
  'README.md',
];

test('com o campo VAZIO, a lista é a dos recentes', () => {
  const r = acharArquivos(ARQUIVOS, '', { recentes: ['README.md', 'src/lib.ts'] });
  assert.deepEqual(r.slice(0, 2), ['README.md', 'src/lib.ts']);
});

test('recente que não existe mais não aparece', () => {
  const r = acharArquivos(ARQUIVOS, '', { recentes: ['sumiu.ts', 'README.md'] });
  assert.equal(r[0], 'README.md');
});

test('sem recentes, o campo vazio mostra a lista como veio', () => {
  assert.deepEqual(acharArquivos(ARQUIVOS, '', { max: 2 }), ['src/utils.ts', 'src/usa-lib.ts']);
});

test('digitar traz o que casa, do melhor para o pior', () => {
  const r = acharArquivos(ARQUIVOS, 'usli');
  assert.equal(r[0], 'src/usa-lib.ts');
});

test('digitar manda na ordem, e não a recência', () => {
  // O contrário poria um arquivo que casou de raspão acima do que casou
  // perfeitamente — e isso se sente como a busca ignorando o que foi digitado.
  const r = acharArquivos(ARQUIVOS, 'lib', { recentes: ['README.md'] });
  assert.equal(r[0], 'src/lib.ts');
});

test('a recência desempata quem casou igual', () => {
  const dois = ['a/mesmo.ts', 'b/mesmo.ts'];
  assert.equal(acharArquivos(dois, 'mesmo', { recentes: ['b/mesmo.ts'] })[0], 'b/mesmo.ts');
  assert.equal(acharArquivos(dois, 'mesmo', { recentes: ['a/mesmo.ts'] })[0], 'a/mesmo.ts');
});

test('o que não casa fica de fora', () => {
  assert.deepEqual(acharArquivos(ARQUIVOS, 'zzz'), []);
});

test('o teto corta a lista', () => {
  assert.equal(acharArquivos(ARQUIVOS, 't', { max: 2 }).length, 2);
});

test('espaço em branco em volta não muda nada', () => {
  assert.deepEqual(acharArquivos(ARQUIVOS, '  lib  '), acharArquivos(ARQUIVOS, 'lib'));
});
