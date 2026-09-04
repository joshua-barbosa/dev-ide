// O que se vê ao abrir uma chave do Redis.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  colunasDe, comandoDeContagem, comandoDeLeitura, linhasDoValor,
  prazoLegivel, talvezJson, tamanhoLegivel, TIPOS_DE_CHAVE, LIMITE_DE_ELEMENTOS,
  comandoDeCriacao, estatisticasDeBancos, lerInfo, tempoDePe,
} from '../sql/redis-chave';

test('cada tipo tem o seu comando de leitura', () => {
  assert.deepEqual(comandoDeLeitura('string', 'k'), {
    nome: 'GET', argumentos: ['k'], forma: 'texto',
  });
  assert.deepEqual(comandoDeLeitura('ReJSON-RL', 'k'), {
    nome: 'JSON.GET', argumentos: ['k', '$'], forma: 'texto',
  });
  assert.equal(comandoDeLeitura('hash', 'k').nome, 'HGETALL');
});

test('coleção é lida com FAIXA, nunca inteira', () => {
  // `LRANGE 0 -1` numa lista de um milhão derruba a memória antes da tela.
  assert.deepEqual(comandoDeLeitura('list', 'k', 10).argumentos, ['k', '0', '9']);
  assert.deepEqual(comandoDeLeitura('zset', 'k', 10).argumentos, ['k', '0', '9', 'WITHSCORES']);
  assert.deepEqual(comandoDeLeitura('stream', 'k', 10).argumentos, ['k', '-', '+', 'COUNT', '10']);
  // `SMEMBERS` não tem faixa; `SSCAN` tem — daí a troca.
  assert.equal(comandoDeLeitura('set', 'k', 10).nome, 'SSCAN');
});

test('todo tipo declarado tem comando — nenhum cai no vazio', () => {
  for (const tipo of TIPOS_DE_CHAVE) {
    assert.ok(comandoDeLeitura(tipo, 'k').nome !== '', `faltou ${tipo}`);
  }
});

test('só coleção tem o que contar', () => {
  assert.equal(comandoDeContagem('hash', 'k')?.nome, 'HLEN');
  assert.equal(comandoDeContagem('stream', 'k')?.nome, 'XLEN');
  assert.equal(comandoDeContagem('string', 'k'), null);
  assert.equal(comandoDeContagem('ReJSON-RL', 'k'), null);
});

test('hash e zset vêm ACHATADOS, e viram pares', () => {
  assert.deepEqual(linhasDoValor('hash', ['a', '1', 'b', '2']), [['a', '1'], ['b', '2']]);
  assert.deepEqual(linhasDoValor('zset', ['x', '9.5']), [['x', '9.5']]);
});

test('par sem o segundo elemento não inventa valor', () => {
  assert.deepEqual(linhasDoValor('hash', ['sozinho']), [['sozinho', '']]);
});

test('a lista numera, para a posição ser visível', () => {
  assert.deepEqual(linhasDoValor('list', ['a', 'b']), [['0', 'a'], ['1', 'b']]);
});

test('o SSCAN devolve [cursor, membros] — o cursor não é membro', () => {
  assert.deepEqual(linhasDoValor('set', ['17', ['a', 'b']]), [['a'], ['b']]);
});

test('o stream junta os campos de cada entrada', () => {
  const resposta = [['1-0', ['campo', 'valor', 'outro', '2']]];
  assert.deepEqual(linhasDoValor('stream', resposta), [['1-0', 'campo=valor outro=2']]);
});

test('resposta que não é lista não quebra a grade', () => {
  assert.deepEqual(linhasDoValor('list', null), []);
  assert.deepEqual(linhasDoValor('stream', 'nada'), []);
});

test('as colunas dizem o que cada tipo tem', () => {
  assert.deepEqual(colunasDe('zset'), ['Membro', 'Nota']);
  assert.deepEqual(colunasDe('hash'), ['Campo', 'Valor']);
  assert.deepEqual(colunasDe('list'), ['#', 'Valor']);
  assert.deepEqual(colunasDe('set'), ['Valor']);
});

test('o prazo vira palavra, e -1 não é "menos um segundo"', () => {
  assert.equal(prazoLegivel(-1), 'sem prazo');
  assert.equal(prazoLegivel(-2), 'expirada');
  assert.equal(prazoLegivel(30), '30s');
  assert.equal(prazoLegivel(90), '1min');
  assert.equal(prazoLegivel(7200), '2h');
  assert.equal(prazoLegivel(200_000), '2d');
});

test('o tamanho vira texto, e o desconhecido não vira zero', () => {
  assert.equal(tamanhoLegivel(512), '512B');
  assert.equal(tamanhoLegivel(10_445), '10.2K');
  assert.equal(tamanhoLegivel(undefined), undefined);
  assert.equal(tamanhoLegivel(-1), undefined);
});

test('JSON fica legível; o que não é JSON volta INTOCADO', () => {
  assert.equal(talvezJson('{"a":1}'), '{\n  "a": 1\n}');
  // Reformatar um texto puro seria corrompê-lo na tela.
  assert.equal(talvezJson('bom dia'), 'bom dia');
  assert.equal(talvezJson('{quebrado'), '{quebrado');
  assert.equal(talvezJson(''), '');
});

test('o limite é um número de verdade, e não zero', () => {
  assert.ok(LIMITE_DE_ELEMENTOS > 0);
});

test('o INFO vira painel, e o que falta fica em BRANCO', () => {
  const bruto = [
    '# Server', 'redis_version:8.6.2', 'redis_mode:standalone',
    'os:Linux6.8.0-1061-awsaarch64', 'uptime_in_seconds:24364800',
    '# Clients', 'connected_clients:24',
    '# Memory', 'used_memory_human:45.30M',
    '# Replication', 'role:master',
  ].join('\n');
  const info = lerInfo(bruto);
  assert.equal(info.versao, '8.6.2');
  assert.equal(info.modo, 'standalone');
  assert.equal(info.papel, 'master');
  assert.equal(info.clientes, 24);
  assert.equal(info.memoria, '45.30M');
  // Servidor gerenciado esconde seções: em branco, e não um valor inventado.
  assert.equal(lerInfo('# Server\nredis_version:7.0.0').papel, '');
});

test('linha sem dois-pontos e cabeçalho de seção são ignorados', () => {
  assert.equal(lerInfo('# Server\nlixo\nredis_version:1.2.3').versao, '1.2.3');
});

test('o uptime vira dias, como na ferramenta que ele usa', () => {
  assert.equal(tempoDePe(24_364_800), '282 dias');
  assert.equal(tempoDePe(86_400), '1 dia');
  assert.equal(tempoDePe(7200), '2h');
  assert.equal(tempoDePe(120), '2min');
});

test('a seção Keyspace vira a tabela de estatísticas', () => {
  const bruto = '# Keyspace\ndb0:keys=4928,expires=277,avg_ttl=42129307\ndb3:keys=1,expires=0,avg_ttl=0\n';
  assert.deepEqual(estatisticasDeBancos(bruto), [
    { nome: 'db0', chaves: 4928, expiram: 277, ttlMedio: 42129307 },
    { nome: 'db3', chaves: 1, expiram: 0, ttlMedio: 0 },
  ]);
});

test('criar cada tipo usa o comando certo', () => {
  assert.deepEqual(comandoDeCriacao('string', 'k', 'oi'), { nome: 'SET', argumentos: ['k', 'oi'] });
  assert.deepEqual(comandoDeCriacao('list', 'k', 'a\nb'), { nome: 'RPUSH', argumentos: ['k', 'a', 'b'] });
  assert.deepEqual(comandoDeCriacao('set', 'k', 'a\nb'), { nome: 'SADD', argumentos: ['k', 'a', 'b'] });
  assert.deepEqual(comandoDeCriacao('hash', 'k', 'f=1\ng=2'), {
    nome: 'HSET', argumentos: ['k', 'f', '1', 'g', '2'],
  });
  assert.deepEqual(comandoDeCriacao('ReJSON-RL', 'k', '{"a":1}'), {
    nome: 'JSON.SET', argumentos: ['k', '$', '{"a":1}'],
  });
});

test('ZADD recebe NOTA antes do membro — a tela escreve ao contrário', () => {
  assert.deepEqual(comandoDeCriacao('zset', 'k', 'joao=9.5'), {
    nome: 'ZADD', argumentos: ['k', '9.5', 'joao'],
  });
  // Membro com `=` no nome: o ÚLTIMO separa, para o nome sobreviver.
  assert.deepEqual(comandoDeCriacao('zset', 'k', 'a=b=3'), {
    nome: 'ZADD', argumentos: ['k', '3', 'a=b'],
  });
});

test('o stream deixa o Redis gerar o id', () => {
  assert.deepEqual(comandoDeCriacao('stream', 'k', 'f=1'), {
    nome: 'XADD', argumentos: ['k', '*', 'f', '1'],
  });
});

test('linha em branco e linha sem par não viram argumento', () => {
  assert.deepEqual(comandoDeCriacao('list', 'k', 'a\n\n  \nb'), {
    nome: 'RPUSH', argumentos: ['k', 'a', 'b'],
  });
  assert.deepEqual(comandoDeCriacao('hash', 'k', 'semigual\nf=1'), {
    nome: 'HSET', argumentos: ['k', 'f', '1'],
  });
});

test('par ANINHADO conta igual ao achatado — as duas formas são reais', () => {
  // RESP2 responde achatado; RESP3, aninhado. Visto contra servidor de verdade.
  assert.deepEqual(linhasDoValor('zset', [['maria', '7'], ['joao', '9.5']]),
    [['maria', '7'], ['joao', '9.5']]);
  assert.deepEqual(linhasDoValor('hash', [['a', '1']]), [['a', '1']]);
});
