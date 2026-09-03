// Quais bancos do Redis aparecem na árvore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bancoDoRotulo, bancosVisiveis, lerKeyspace, lerListaDeBancos, lerQuantosBancos,
  QUANTOS_BANCOS_PADRAO,
} from '../sql/redis-bancos';

test('o keyspace conta as chaves de cada banco', () => {
  const info = '# Keyspace\r\ndb0:keys=3,expires=0,avg_ttl=0\r\ndb5:keys=1200,expires=7\r\n';
  const contagens = lerKeyspace(info);
  assert.equal(contagens.get(0), 3);
  assert.equal(contagens.get(5), 1200);
  assert.equal(contagens.size, 2, 'banco vazio não aparece no INFO');
});

test('linha que não é de banco é ignorada', () => {
  assert.equal(lerKeyspace('# Keyspace\nused_memory:12345\ndb\n').size, 0);
});

test('CONFIG GET databases; recusa ou lixo cai no padrão', () => {
  assert.equal(lerQuantosBancos(['databases', '4']), 4);
  assert.equal(lerQuantosBancos(null), QUANTOS_BANCOS_PADRAO);
  assert.equal(lerQuantosBancos(['databases', 'muitos']), QUANTOS_BANCOS_PADRAO);
  assert.equal(lerQuantosBancos(['databases', '0']), QUANTOS_BANCOS_PADRAO);
});

test('a lista aceita como ele lê na árvore, e não só o número cru', () => {
  assert.deepEqual(lerListaDeBancos('0, 3, db7'), [0, 3, 7]);
  assert.deepEqual(lerListaDeBancos('1\n2;3 4'), [1, 2, 3, 4]);
  assert.deepEqual(lerListaDeBancos('2, 2, db2'), [2], 'repetido conta uma vez');
  assert.deepEqual(lerListaDeBancos(''), []);
  assert.deepEqual(lerListaDeBancos(undefined), []);
  assert.deepEqual(lerListaDeBancos('-1, abc'), []);
});

test('desligado, a árvore mostra só o banco da conexão — como sempre foi', () => {
  const bancos = bancosVisiveis({
    todos: false, bancoDaConexao: 3, quantos: 16, escolhidos: [1, 2],
  });
  assert.deepEqual(bancos.map((b) => b.rotulo), ['db3']);
});

test('ligado sem lista, mostra todos os que o servidor tem', () => {
  const bancos = bancosVisiveis({
    todos: true, bancoDaConexao: 0, quantos: 4, escolhidos: [],
  });
  assert.deepEqual(bancos.map((b) => b.rotulo), ['db0', 'db1', 'db2', 'db3']);
});

test('a lista branca vence, e banco fora do alcance do servidor cai fora', () => {
  const bancos = bancosVisiveis({
    todos: true, bancoDaConexao: 0, quantos: 4, escolhidos: [1, 3, 20],
  });
  assert.deepEqual(bancos.map((b) => b.numero), [1, 3]);
});

test('sem INFO não se afirma contagem; com INFO, banco ausente é ZERO', () => {
  const sem = bancosVisiveis({ todos: true, bancoDaConexao: 0, quantos: 2, escolhidos: [] });
  assert.equal(sem[0]?.chaves, undefined);

  const com = bancosVisiveis({
    todos: true, bancoDaConexao: 0, quantos: 2, escolhidos: [],
    contagens: new Map([[0, 9]]),
  });
  assert.equal(com[0]?.chaves, 9);
  assert.equal(com[1]?.chaves, 0, 'não apareceu no INFO porque está vazio');
});

test('o rótulo volta a ser número, e o que não é banco devolve null', () => {
  assert.equal(bancoDoRotulo('db12'), 12);
  assert.equal(bancoDoRotulo('@chaves'), null);
  assert.equal(bancoDoRotulo(undefined), null);
  assert.equal(bancoDoRotulo('db'), null);
});
