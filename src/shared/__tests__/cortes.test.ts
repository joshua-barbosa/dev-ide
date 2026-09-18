import test from 'node:test';
import assert from 'node:assert/strict';
import { remapearCortes, tamanhoRealDe } from '../grade/cortes';

test('sem corte nenhum, nada a remapear', () => {
  assert.deepEqual(remapearCortes(undefined, [0, 1, 2]), {});
  assert.deepEqual(remapearCortes({}, [0, 1, 2]), {});
});

test('a busca esconde linhas e o corte anda junto', () => {
  // A linha 7 da página virou a 1ª visível: sem remapear, o aviso apareceria
  // na linha 1 da página, que não foi cortada.
  const cortes = { '7:2': 50_000, '9:0': 1234 };
  assert.deepEqual(remapearCortes(cortes, [7, 9]), { '0:2': 50_000, '1:0': 1234 });
});

test('corte de linha que saiu da tela some', () => {
  assert.deepEqual(remapearCortes({ '3:1': 900 }, [0, 1]), {});
});

test('sem filtro, as posições não mudam', () => {
  const cortes = { '2:1': 77 };
  assert.deepEqual(remapearCortes(cortes, [0, 1, 2, 3]), cortes);
});

test('a consulta de tamanho é por linha e coluna', () => {
  assert.equal(tamanhoRealDe({ '1:3': 42 }, 1, 3), 42);
  assert.equal(tamanhoRealDe({ '1:3': 42 }, 1, 2), null);
  assert.equal(tamanhoRealDe(undefined, 0, 0), null);
});
