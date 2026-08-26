import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HistoricoDeSubstituicoes, MAX_BYTES_GUARDADOS, MAX_DESFAZER,
} from '../desfazer-substituicao';

function item(id: string, bytes = 10) {
  return {
    id, termo: 'a', substituto: 'b', quando: '2026-08-26T00:00:00.000Z',
    antes: new Map([[`/x/${id}.ts`, 'x'.repeat(bytes)]]),
  };
}

test('guarda e devolve a mais recente', () => {
  const h = new HistoricoDeSubstituicoes();
  h.guardar(item('um'));
  h.guardar(item('dois'));
  assert.equal(h.ultima()?.id, 'dois');
});

test('o teto de quantidade descarta as MAIS ANTIGAS', () => {
  const h = new HistoricoDeSubstituicoes();
  for (let i = 0; i < MAX_DESFAZER + 3; i += 1) h.guardar(item(`s${i}`));
  assert.equal(h.lista().length, MAX_DESFAZER);
  // A mais nova continua lá; a primeira saiu.
  assert.equal(h.lista()[0]?.id, `s${MAX_DESFAZER + 2}`);
  assert.equal(h.lista().some((s) => s.id === 's0'), false);
});

test('o teto de BYTES é a parede que importa', () => {
  // Uma substituição em duzentos arquivos grandes pesa mais que cinco
  // pequenas — e é esse o caso que prende memória.
  const h = new HistoricoDeSubstituicoes();
  h.guardar(item('pequena', 10));
  const descartadas = h.guardar(item('enorme', MAX_BYTES_GUARDADOS + 1));
  assert.equal(descartadas, 1);
  assert.equal(h.lista().length, 1);
  assert.equal(h.lista()[0]?.id, 'enorme');
});

test('a última NUNCA é descartada, nem estourando sozinha o teto', () => {
  // Desfazer a que acabou de acontecer é o caso que o usuário mais precisa;
  // jogá-la fora por tamanho seria o pior momento possível.
  const h = new HistoricoDeSubstituicoes();
  h.guardar(item('gigante', MAX_BYTES_GUARDADOS * 2));
  assert.equal(h.lista().length, 1);
  assert.equal(h.ultima()?.id, 'gigante');
});

test('retirar tira a que foi pedida, e não a do topo', () => {
  const h = new HistoricoDeSubstituicoes();
  h.guardar(item('um'));
  h.guardar(item('dois'));
  assert.equal(h.retirar('um')?.id, 'um');
  assert.equal(h.lista().length, 1);
  assert.equal(h.ultima()?.id, 'dois');
});

test('retirar o que não existe devolve null, sem estragar a pilha', () => {
  const h = new HistoricoDeSubstituicoes();
  h.guardar(item('um'));
  assert.equal(h.retirar('inexistente'), null);
  assert.equal(h.lista().length, 1);
});

test('a lista sai da MAIS NOVA para a mais velha', () => {
  const h = new HistoricoDeSubstituicoes();
  h.guardar(item('um'));
  h.guardar(item('dois'));
  assert.deepEqual(h.lista().map((s) => s.id), ['dois', 'um']);
});

test('vazio devolve null, e não estoura', () => {
  const h = new HistoricoDeSubstituicoes();
  assert.equal(h.ultima(), null);
  assert.deepEqual(h.lista(), []);
  assert.equal(h.bytes(), 0);
});
