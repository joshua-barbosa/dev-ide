// A pesquisa rápida da aba SFTP/FTP, como a do FileZilla (relato de 01/10:
// "aqui não tem um pesquisar na pasta igual no FileZilla" — ele procurava
// "26314" numa pasta de 138 arquivos).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filtrarPorNome } from '../sftp/pesquisa-rapida';

const nomes = (xs: { name: string }[]) => xs.map((x) => x.name);
const pasta = [
  { name: 'ETAPA_PED00026314_20260930160245.inf' },
  { name: '162917961236_4917067id180853.TMP' },
  { name: 'Relatório Final.PDF' },
  { name: 'notas.txt' },
];

test('trecho em qualquer parte do nome (o caso dele)', () => {
  assert.deepEqual(nomes(filtrarPorNome(pasta, '26314')), ['ETAPA_PED00026314_20260930160245.inf']);
});

test('sem diferença de maiúscula e de acento', () => {
  assert.deepEqual(nomes(filtrarPorNome(pasta, 'relatorio final')), ['Relatório Final.PDF']);
  assert.deepEqual(nomes(filtrarPorNome(pasta, '.tmp')), ['162917961236_4917067id180853.TMP']);
});

test('* e ? como coringa: o nome INTEIRO tem de casar', () => {
  assert.deepEqual(nomes(filtrarPorNome(pasta, '*.inf')), ['ETAPA_PED00026314_20260930160245.inf']);
  assert.deepEqual(nomes(filtrarPorNome(pasta, 'nota?.txt')), ['notas.txt']);
  assert.deepEqual(nomes(filtrarPorNome(pasta, '*.txt*')), ['notas.txt']);
});

test('vazio ou só espaço: tudo', () => {
  assert.equal(filtrarPorNome(pasta, '').length, 4);
  assert.equal(filtrarPorNome(pasta, '   ').length, 4);
});

test('caracteres de expressão regular no termo são texto', () => {
  assert.deepEqual(nomes(filtrarPorNome([{ name: 'a(1).txt' }, { name: 'a1.txt' }], '(1)')), ['a(1).txt']);
});
