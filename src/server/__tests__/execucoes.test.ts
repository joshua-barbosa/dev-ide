import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RegistroDeExecucoes } from '../execucoes';

test('parar chama o encerrador e diz que havia', () => {
  const registro = new RegistroDeExecucoes();
  let matou = 0;
  registro.registrar('a', () => { matou += 1; });

  assert.equal(registro.parar('a'), true);
  assert.equal(matou, 1);
});

test('parar o que não existe devolve falso, sem lançar', () => {
  assert.equal(new RegistroDeExecucoes().parar('nao-existe'), false);
});

test('parar duas vezes não mata duas vezes', () => {
  const registro = new RegistroDeExecucoes();
  let matou = 0;
  registro.registrar('a', () => { matou += 1; });

  registro.parar('a');
  assert.equal(registro.parar('a'), false);
  assert.equal(matou, 1, 'clicar com pressa não pode matar a execução seguinte');
});

test('concluir tira do registro — o id não pode sobreviver à execução', () => {
  const registro = new RegistroDeExecucoes();
  registro.registrar('a', () => assert.fail('não deveria ser chamado'));
  registro.concluir('a');

  assert.equal(registro.parar('a'), false);
  assert.equal(registro.quantidade, 0);
});

test('registrar de novo substitui: compilar e rodar são o mesmo botão', () => {
  const registro = new RegistroDeExecucoes();
  const chamados: string[] = [];
  registro.registrar('a', () => chamados.push('gcc'));
  registro.registrar('a', () => chamados.push('binário'));

  registro.parar('a');
  assert.deepEqual(chamados, ['binário']);
  assert.equal(registro.quantidade, 0);
});

test('execuções diferentes não se atrapalham', () => {
  const registro = new RegistroDeExecucoes();
  const mortos: string[] = [];
  registro.registrar('a', () => mortos.push('a'));
  registro.registrar('b', () => mortos.push('b'));

  registro.parar('a');
  assert.deepEqual(mortos, ['a']);
  assert.equal(registro.quantidade, 1);
});

test('pararTudo encerra todas e esvazia', () => {
  const registro = new RegistroDeExecucoes();
  const mortos: string[] = [];
  for (const id of ['a', 'b', 'c']) registro.registrar(id, () => mortos.push(id));

  registro.pararTudo();
  assert.deepEqual(mortos.sort(), ['a', 'b', 'c']);
  assert.equal(registro.quantidade, 0);
});
