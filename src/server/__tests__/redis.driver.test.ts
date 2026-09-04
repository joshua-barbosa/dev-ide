// O driver do Redis contra um servidor DE VERDADE.
//
// Sobe um `redis-server` próprio numa porta livre e o mata no fim. Existe
// porque o modelo puro não prova nada sobre a forma da árvore nem sobre o que o
// `TYPE` responde — foi exatamente por isso que a árvore do Redis passou uma
// spec inteira sem chegar ao segundo nível.
//
// Pula quando não há `redis-server` na máquina, em vez de quebrar a suíte.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { redisDriver } from '../connections/drivers/redis';
import type { Session } from '../connections/types';

const TEM_REDIS = spawnSync('redis-server', ['--version']).status === 0;

function portaLivre(): number {
  const servidor = createServer();
  servidor.listen(0);
  const { port } = servidor.address() as { port: number };
  servidor.close();
  return port;
}

const PORTA = portaLivre();
let processo: ChildProcess | null = null;
let sessao: Session | null = null;

before(async () => {
  if (!TEM_REDIS) return;
  processo = spawn('redis-server', ['--port', String(PORTA), '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore',
  });
  // Espera o servidor atender, em vez de dormir um tempo fixo.
  for (let i = 0; i < 60; i += 1) {
    const r = spawnSync('redis-cli', ['-p', String(PORTA), 'PING'], { encoding: 'utf8' });
    if (r.stdout.trim() === 'PONG') break;
    await new Promise((r2) => setTimeout(r2, 100));
  }
  const cli = (...args: string[]): void => {
    spawnSync('redis-cli', ['-p', String(PORTA), ...args], { stdio: 'ignore' });
  };
  cli('SET', 'texto', 'bom dia');
  cli('SET', 'json-como-texto', '{"a":1}');
  cli('RPUSH', 'lista', 'um', 'dois', 'tres');
  cli('SADD', 'conjunto', 'a', 'b');
  cli('ZADD', 'ranque', '9.5', 'joao', '7', 'maria');
  cli('HSET', 'mapa', 'campo', 'valor', 'outro', '2');
  cli('XADD', 'fila', '*', 'evento', 'entrou');
  cli('SET', 'com-prazo', 'x', 'EX', '600');

  sessao = await redisDriver.connect({
    id: 'r1', type: 'redis', label: 'local', readOnly: false,
    fields: { modo: 'campos', host: '127.0.0.1', port: PORTA, database: 0 },
  });
});

after(async () => {
  await sessao?.close();
  processo?.kill();
});

const pular = { skip: TEM_REDIS ? false : 'sem redis-server nesta máquina' };

test('a árvore chega às CHAVES — servidor, categorias, prefixos', pular, async () => {
  const raiz = await sessao!.children([]);
  assert.equal(raiz.length, 1, 'a raiz é o nó do servidor');

  const categorias = await sessao!.children([raiz[0]!.id]);
  assert.ok(categorias.some((c) => c.label === 'Chaves'), 'faltou a categoria Chaves');

  const chaves = await sessao!.children([raiz[0]!.id, '@chaves']);
  const nomes = chaves.map((n) => n.label);
  assert.ok(nomes.includes('texto'), `esperava a chave "texto" em ${JSON.stringify(nomes)}`);
});

test('string: o valor sai como texto', pular, async () => {
  const v = await sessao!.readKey!('texto');
  assert.equal(v.tipo, 'string');
  assert.equal(v.forma, 'texto');
  assert.equal(v.texto, 'bom dia');
  assert.equal(v.ttl, -1, 'sem prazo');
});

test('lista, conjunto, ranque, mapa e fila saem em GRADE', pular, async () => {
  const lista = await sessao!.readKey!('lista');
  assert.equal(lista.forma, 'grade');
  assert.deepEqual(lista.colunas, ['#', 'Valor']);
  assert.deepEqual(lista.linhas, [['0', 'um'], ['1', 'dois'], ['2', 'tres']]);
  assert.equal(lista.total, 3);
  assert.equal(lista.cortado, false);

  const conjunto = await sessao!.readKey!('conjunto');
  assert.equal(conjunto.linhas?.length, 2, 'o cursor do SSCAN não é membro');

  const ranque = await sessao!.readKey!('ranque');
  assert.deepEqual(ranque.colunas, ['Membro', 'Nota']);
  assert.deepEqual(ranque.linhas, [['maria', '7'], ['joao', '9.5']]);

  const mapa = await sessao!.readKey!('mapa');
  assert.equal(mapa.linhas?.length, 2);

  const fila = await sessao!.readKey!('fila');
  assert.equal(fila.tipo, 'stream');
  assert.match(fila.linhas![0]![1]!, /evento=entrou/);
});

test('o prazo vem em segundos, e chave que não existe DIZ isso', pular, async () => {
  const v = await sessao!.readKey!('com-prazo');
  assert.ok(v.ttl > 0 && v.ttl <= 600, `ttl inesperado: ${v.ttl}`);
  await assert.rejects(
    () => sessao!.readKey!('nao-existe'),
    /não existe/,
    'chave ausente tem de dizer, e não devolver vazio'
  );
});

test('gravar TROCA o valor de uma coleção, em vez de acrescentar', pular, async () => {
  await sessao!.writeKey!({ chave: 'lista', tipo: 'list', valor: 'novo\nunico' });
  const v = await sessao!.readKey!('lista');
  assert.deepEqual(v.linhas, [['0', 'novo'], ['1', 'unico']]);
});

test('o prazo se muda e se tira sem tocar no valor', pular, async () => {
  await sessao!.writeKey!({ chave: 'texto', tipo: 'string', ttl: 120 });
  assert.ok((await sessao!.readKey!('texto')).ttl > 0);
  await sessao!.writeKey!({ chave: 'texto', tipo: 'string', ttl: -1 });
  const v = await sessao!.readKey!('texto');
  assert.equal(v.ttl, -1);
  assert.equal(v.texto, 'bom dia', 'mexer no prazo não pode mexer no valor');
});

test('apagar por PREFIXO leva as do prefixo e deixa as outras', pular, async () => {
  await sessao!.writeKey!({ chave: 'lote:a', tipo: 'string', valor: '1' });
  await sessao!.writeKey!({ chave: 'lote:b', tipo: 'string', valor: '2' });
  const quantas = await sessao!.deleteKey!({ prefixo: 'lote:' });
  assert.equal(quantas, 2);
  assert.ok((await sessao!.readKey!('conjunto')).linhas!.length > 0, 'não podia levar as outras');
});

test('o estado do servidor traz versão, memória e as estatísticas por banco', pular, async () => {
  const info = await sessao!.estadoDoServidor!();
  assert.match(info.versao, /^\d+\./);
  assert.equal(info.modo, 'standalone');
  assert.ok(info.clientes >= 1);
  assert.ok(info.bancos.some((b) => b.nome === 'db0' && b.chaves > 0), 'faltou db0');
});

test('somente-leitura RECUSA gravar e apagar', pular, async () => {
  const trancada = await redisDriver.connect({
    id: 'r2', type: 'redis', label: 'local-ro', readOnly: true,
    fields: { modo: 'campos', host: '127.0.0.1', port: PORTA, database: 0 },
  });
  await assert.rejects(
    () => trancada.writeKey!({ chave: 'texto', tipo: 'string', valor: 'x' }),
    /somente-leitura/
  );
  await assert.rejects(() => trancada.deleteKey!({ chave: 'texto' }), /somente-leitura/);
  // E continua LENDO.
  assert.equal((await trancada.readKey!('texto')).texto, 'bom dia');
  await trancada.close();
});

test('reabrir um nó NÃO dobra a contagem das chaves', pular, async () => {
  // Uma varredura completa era refeita por cima do mesmo acumulador: a cada
  // reabertura a contagem dobrava, e uma chave contada duas vezes virava PASTA
  // na árvore — clicar nela expandia em vez de abrir. Visto na tela.
  const raiz = await sessao!.children([]);
  const caminho = [raiz[0]!.id, '@chaves'];

  const primeira = await sessao!.children(caminho);
  const segunda = await sessao!.children(caminho);
  const terceira = await sessao!.children(caminho);

  assert.deepEqual(
    segunda.map((n) => [n.label, n.detail]),
    primeira.map((n) => [n.label, n.detail]),
    'a segunda abertura tem de ver o mesmo que a primeira'
  );
  assert.deepEqual(terceira.map((n) => n.detail), primeira.map((n) => n.detail));
  assert.ok(
    primeira.every((n) => n.label !== ''),
    'nenhum ramo pode nascer sem nome'
  );
});
