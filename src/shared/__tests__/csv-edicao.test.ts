// Editar um CSV pela grade (P5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarTrocasNoCsv, campoEmTexto, csvComTrocas, escreverTabular,
  porQueNaoPodeGravar, quebraDe, terminaComQuebra,
} from '../editor/csv-edicao';
import { lerTabular } from '../editor/visualizadores';

// ---------------------------------------------------------------------------
// Escapar só quando precisa
// ---------------------------------------------------------------------------

test('campo simples sai sem aspas', () => {
  assert.equal(campoEmTexto('ana', ','), 'ana');
});

test('campo com o separador dentro ganha aspas', () => {
  assert.equal(campoEmTexto('ana, maria', ','), '"ana, maria"');
  // E com `;` como separador, a vírgula é dado comum.
  assert.equal(campoEmTexto('ana, maria', ';'), 'ana, maria');
});

test('aspa dentro é dobrada', () => {
  assert.equal(campoEmTexto('diz "oi"', ','), '"diz ""oi"""');
});

test('quebra de linha dentro do campo ganha aspas', () => {
  assert.equal(campoEmTexto('duas\nlinhas', ','), '"duas\nlinhas"');
});

// ---------------------------------------------------------------------------
// Ler e escrever têm de fechar
// ---------------------------------------------------------------------------

test('o que se lê e se escreve de volta é o mesmo texto', () => {
  const original = 'nome,idade\n"silva, joão",30\n"diz ""oi""",41';
  const { linhas } = lerTabular(original, ',');
  assert.equal(escreverTabular(linhas, ','), original);
});

test('a quebra do arquivo é preservada — CRLF continua CRLF', () => {
  // Reescrever um CSV do Windows com \n mudaria TODAS as linhas no diff por
  // causa de uma célula.
  const original = 'a,b\r\n1,2\r\n';
  assert.equal(quebraDe(original), '\r\n');
  const { linhas } = lerTabular(original, ',');
  assert.equal(escreverTabular(linhas, ',', '\r\n'), 'a,b\r\n1,2');
});

test('a quebra final também', () => {
  assert.equal(terminaComQuebra('a,b\n1,2\n'), true);
  assert.equal(terminaComQuebra('a,b\n1,2'), false);
});

// ---------------------------------------------------------------------------
// A troca é POR POSIÇÃO
// ---------------------------------------------------------------------------

test('trocar uma célula não toca nas outras', () => {
  const linhas = [['nome', 'idade'], ['ana', '30'], ['bia', '41']];
  const novas = aplicarTrocasNoCsv(linhas, [{ linha: 2, coluna: 1, valor: '42' }]);
  assert.deepEqual(novas, [['nome', 'idade'], ['ana', '30'], ['bia', '42']]);
});

test('não muta a entrada', () => {
  const linhas = [['a'], ['b']];
  aplicarTrocasNoCsv(linhas, [{ linha: 1, coluna: 0, valor: 'z' }]);
  assert.deepEqual(linhas, [['a'], ['b']]);
});

test('troca fora do alcance é IGNORADA, e não cria linha do nada', () => {
  const linhas = [['a']];
  assert.deepEqual(aplicarTrocasNoCsv(linhas, [{ linha: 9, coluna: 0, valor: 'z' }]), [['a']]);
  assert.deepEqual(aplicarTrocasNoCsv(linhas, [{ linha: 0, coluna: 5, valor: 'z' }]), [['a']]);
});

test('duas linhas IDÊNTICAS são distinguidas pela posição', () => {
  // É a razão de a identidade ser a posição: num CSV nada mais as distingue.
  const linhas = [['x'], ['igual'], ['igual']];
  const novas = aplicarTrocasNoCsv(linhas, [{ linha: 2, coluna: 0, valor: 'mudou' }]);
  assert.deepEqual(novas, [['x'], ['igual'], ['mudou']]);
});

// ---------------------------------------------------------------------------
// O arquivo grande NÃO grava — é o defeito que apagaria dados
// ---------------------------------------------------------------------------

test('CSV truncado não pode ser gravado, e o motivo diz por quê', () => {
  const motivo = porQueNaoPodeGravar(true);
  assert.notEqual(motivo, null);
  assert.match(motivo ?? '', /apagaria o resto/);
});

test('CSV inteiro pode ser gravado', () => {
  assert.equal(porQueNaoPodeGravar(false), null);
});

// ---------------------------------------------------------------------------
// O caminho completo
// ---------------------------------------------------------------------------

test('sem trocas, o arquivo volta IDÊNTICO — nem o diff mexe', () => {
  // Reescrever "igual em espírito" mostraria o arquivo inteiro mudado.
  const original = 'a;b\r\n"1";2\r\n';
  const { linhas } = lerTabular(original, ';');
  assert.equal(csvComTrocas(original, linhas, ';', []), original);
});

test('com troca, muda só o que mudou — e a quebra final fica', () => {
  const original = 'nome,idade\nana,30\nbia,41\n';
  const { linhas } = lerTabular(original, ',');
  const novo = csvComTrocas(original, linhas, ',', [{ linha: 1, coluna: 1, valor: '31' }]);
  assert.equal(novo, 'nome,idade\nana,31\nbia,41\n');
});

test('valor novo que precisa de aspas ganha aspas ao gravar', () => {
  const original = 'nome,obs\nana,vazio\n';
  const { linhas } = lerTabular(original, ',');
  const novo = csvComTrocas(original, linhas, ',', [
    { linha: 1, coluna: 1, valor: 'mora em Bauru, SP' },
  ]);
  assert.equal(novo, 'nome,obs\nana,"mora em Bauru, SP"\n');
});

test('o CRLF sobrevive à edição', () => {
  const original = 'a,b\r\n1,2\r\n';
  const { linhas } = lerTabular(original, ',');
  assert.equal(csvComTrocas(original, linhas, ',', [{ linha: 1, coluna: 0, valor: '9' }]),
    'a,b\r\n9,2\r\n');
});
