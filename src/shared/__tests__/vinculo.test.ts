import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mesmoVinculo, pastaDoVinculo, vinculoDaPasta, vinculoDoCaminho } from '../sql/vinculo';

test('a pasta leva conexão e database, e volta inteira', () => {
  const v = { connectionId: 'abc123', database: 'servidor-2' };
  assert.equal(pastaDoVinculo(v), 'abc123@servidor-2');
  assert.deepEqual(vinculoDaPasta('abc123@servidor-2'), v);
});

test('database com caractere estranho sobrevive à ida e à volta', () => {
  // Nome de database vem do banco: pode ter barra, espaço, acento e até `..`.
  for (const database of ['meu banco', 'a/b', '..', 'ação', 'com@arroba', '%']) {
    const v = { connectionId: 'id-1', database };
    assert.deepEqual(vinculoDaPasta(pastaDoVinculo(v)), v, database);
  }
});

test('o nome codificado nunca traz separador de caminho', () => {
  // É o que garante que a pasta do vínculo não vire duas pastas.
  const nome = pastaDoVinculo({ connectionId: 'id', database: '../../etc' });
  assert.equal(nome.includes('/'), false);
});

test('pasta fora do formato não vira vínculo', () => {
  assert.equal(vinculoDaPasta('semarroba'), null);
  assert.equal(vinculoDaPasta('@sodatabase'), null);
  assert.equal(vinculoDaPasta('soconexao@'), null);
  assert.equal(vinculoDaPasta(''), null);
});

test('percentagem malformada não vira vínculo', () => {
  assert.equal(vinculoDaPasta('id@%zz'), null);
});

test('deriva o vínculo do caminho de um arquivo sob a raiz', () => {
  assert.deepEqual(vinculoDoCaminho('/dados/query', '/dados/query/abc@servidor-2/x.sql'), {
    connectionId: 'abc',
    database: 'servidor-2',
  });
});

test('arquivo fora da raiz não tem vínculo pelo caminho', () => {
  assert.equal(vinculoDoCaminho('/dados/query', '/projeto/x.sql'), null);
  // Prefixo parecido não conta: `/dados/queryX` não está sob `/dados/query`.
  assert.equal(vinculoDoCaminho('/dados/query', '/dados/queryX/abc@g/x.sql'), null);
});

test('arquivo solto na raiz, ou fundo demais, não tem vínculo', () => {
  assert.equal(vinculoDoCaminho('/dados/query', '/dados/query/x.sql'), null);
  assert.equal(vinculoDoCaminho('/dados/query', '/dados/query/abc@g/sub/x.sql'), null);
});

test('raiz com barra no fim dá o mesmo resultado', () => {
  assert.deepEqual(
    vinculoDoCaminho('/dados/query/', '/dados/query/abc@g/x.sql'),
    vinculoDoCaminho('/dados/query', '/dados/query/abc@g/x.sql')
  );
});

test('mesmoVinculo compara os dois campos, e trata nulo', () => {
  const a = { connectionId: '1', database: 'g' };
  assert.equal(mesmoVinculo(a, { ...a }), true);
  assert.equal(mesmoVinculo(a, { ...a, database: 'outro' }), false);
  assert.equal(mesmoVinculo(null, null), true);
  assert.equal(mesmoVinculo(a, null), false);
});
