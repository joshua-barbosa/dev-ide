// Redis numa árvore e numa grade.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  destinoDaConexao, lerComando, lerUrlDeRedis, linhasDaResposta, modoDeConexao,
  podeRodarSomenteLeitura, ramosDe,
} from '../sql/redis-modelo';

// ---------------------------------------------------------------------------
// A árvore de chaves
// ---------------------------------------------------------------------------

const CHAVES = [
  'sessao:1234', 'sessao:5678', 'cache:usuario:9', 'cache:usuario:10',
  'cache:produto:1', 'avulsa',
];

test('a raiz agrupa pelo primeiro segmento', () => {
  const r = ramosDe(CHAVES);
  assert.deepEqual(r.map((x) => x.nome), ['avulsa', 'cache', 'sessao']);
  assert.deepEqual(r.map((x) => x.quantas), [1, 3, 2]);
});

test('desce um nível por vez — e não a árvore inteira', () => {
  // Um Redis de produção tem milhões de chaves; montar tudo travaria a IDE
  // antes de mostrar qualquer coisa.
  const r = ramosDe(CHAVES, 'cache:');
  assert.deepEqual(r.map((x) => x.nome), ['produto', 'usuario']);
  assert.equal(r.find((x) => x.nome === 'usuario')?.quantas, 2);
});

test('chave sem separador aparece como CHAVE, não como ramo vazio', () => {
  assert.equal(ramosDe(CHAVES).find((x) => x.nome === 'avulsa')?.ehChave, true);
  assert.equal(ramosDe(CHAVES).find((x) => x.nome === 'cache')?.ehChave, false);
});

test('uma chave que é EXATAMENTE o prefixo convive com os ramos', () => {
  // `sessao` pode ser uma chave e o começo de `sessao:1234`. Esconder uma das
  // duas mentiria sobre o que está no banco.
  const r = ramosDe(['sessao', 'sessao:1234']);
  const s = r.find((x) => x.nome === 'sessao');
  assert.equal(s?.ehChave, true);
  assert.equal(s?.quantas, 2);
});

test('prefixo que não casa com nada devolve vazio, e não estoura', () => {
  assert.deepEqual(ramosDe(CHAVES, 'nao-existe:'), []);
});

// ---------------------------------------------------------------------------
// A trava de somente-leitura
// ---------------------------------------------------------------------------

test('a lista é BRANCA: o que não está nela é recusado', () => {
  // Lista negra erraria por omissão a cada versão nova do Redis — e errar por
  // omissão numa trava é o mesmo que não ter trava.
  assert.equal(podeRodarSomenteLeitura('GET'), true);
  assert.equal(podeRodarSomenteLeitura('hgetall'), true);
  assert.equal(podeRodarSomenteLeitura('DEL'), false);
  assert.equal(podeRodarSomenteLeitura('FLUSHALL'), false);
  assert.equal(podeRodarSomenteLeitura('comando-que-nao-existe-ainda'), false);
});

test('maiúsculas não driblam a trava', () => {
  assert.equal(podeRodarSomenteLeitura('FlUsHdB'), false);
});

// ---------------------------------------------------------------------------
// Ler o comando digitado
// ---------------------------------------------------------------------------

test('aspas mantêm o valor com espaço como UM argumento', () => {
  // `SET saudacao "bom dia"` são dois argumentos, não três — e o erro só
  // apareceria no dado gravado errado.
  const c = lerComando('SET saudacao "bom dia"');
  assert.equal(c?.nome, 'SET');
  assert.deepEqual(c?.argumentos, ['saudacao', 'bom dia']);
});

test('aspa escapada vira aspa dentro do valor', () => {
  assert.deepEqual(lerComando('SET x "diz \\"oi\\""')?.argumentos, ['x', 'diz "oi"']);
});

test('espaço a mais não vira argumento vazio', () => {
  assert.deepEqual(lerComando('  GET   chave  ')?.argumentos, ['chave']);
});

test('linha vazia não é comando', () => {
  assert.equal(lerComando('   '), null);
});

// ---------------------------------------------------------------------------
// A resposta na grade
// ---------------------------------------------------------------------------

test('escalar vira uma linha de uma coluna', () => {
  assert.deepEqual(linhasDaResposta('ola'), { colunas: ['valor'], linhas: [['ola']] });
});

test('nil é mostrado como (nil), e não como vazio', () => {
  // Vazio e ausente são coisas diferentes num banco chave-valor.
  assert.deepEqual(linhasDaResposta(null).linhas, [['(nil)']]);
});

test('lista vira linhas numeradas', () => {
  const r = linhasDaResposta(['a', 'b']);
  assert.deepEqual(r.colunas, ['#', 'valor']);
  assert.deepEqual(r.linhas, [['1', 'a'], ['2', 'b']]);
});

test('mapa vira campo e valor — como um HGETALL se lê', () => {
  const r = linhasDaResposta({ nome: 'ana', idade: 30 });
  assert.deepEqual(r.colunas, ['campo', 'valor']);
  assert.deepEqual(r.linhas, [['nome', 'ana'], ['idade', '30']]);
});

test('valor aninhado vira JSON em vez de [object Object]', () => {
  assert.equal(linhasDaResposta({ a: { b: 1 } }).linhas[0]?.[1], '{"b":1}');
});

// ---------------------------------------------------------------------------
// As duas formas de conectar
// ---------------------------------------------------------------------------

const url = (t: string) => lerUrlDeRedis(t);
const erroDe = (r: unknown): string => (r as { erro?: string }).erro ?? '';
const destDe = (r: unknown) => (r as { destino: ReturnType<typeof Object> }).destino as never;

test('URL completa vira host, porta, usuário, senha e banco', () => {
  const r = url('redis://ana:segredo@10.0.0.5:6380/2');
  assert.deepEqual(destDe(r), {
    host: '10.0.0.5', porta: 6380, usuario: 'ana', senha: 'segredo', banco: 2,
    tls: false, standalone: false,
  });
});

test('SÓ SENHA: `redis://:senha@host` não inventa usuário', () => {
  // Ele: "tem alguns acessos que não têm usuário, só password". Mandar
  // `default` viraria `AUTH default senha`, que o Redis 5 recusa — e a falha
  // apareceria como "autenticação inválida", sem dizer que a IDE acrescentou
  // um usuário que ninguém pediu.
  const d = destDe(url('redis://:segredo@servidor:6379'));
  assert.equal((d as { usuario: string }).usuario, '');
  assert.equal((d as { senha: string }).senha, 'segredo');
});

test('campos separados sem usuário também não inventam', () => {
  const d = destDe(destinoDaConexao({ modo: 'campos', host: 'h', password: 'p' }));
  assert.equal((d as { usuario: string }).usuario, '');
});

test('`rediss://` com dois esses é TLS', () => {
  // Um `s` a mais decide se o tráfego vai cifrado, e confundir os dois falha
  // com "connection reset", que não diz nada sobre o que estava errado.
  assert.equal((destDe(url('rediss://h:6379')) as { tls: boolean }).tls, true);
  assert.equal((destDe(url('redis://h:6379')) as { tls: boolean }).tls, false);
});

test('senha com @ e : chega inteira', () => {
  // Quem tem `p@ss` na senha veria a IDE cortar o host no lugar errado.
  const d = destDe(url('redis://:p%40ss%3Aword@h:6379'));
  assert.equal((d as { senha: string }).senha, 'p@ss:word');
  assert.equal((d as { host: string }).host, 'h');
});

test('sem porta e sem banco, valem 6379 e 0', () => {
  const d = destDe(url('redis://h'));
  assert.equal((d as { porta: number }).porta, 6379);
  assert.equal((d as { banco: number }).banco, 0);
});

test('protocolo errado é recusado dizendo o certo', () => {
  assert.match(erroDe(url('http://h:6379')), /redis:\/\/.*rediss:\/\//s);
});

test('caminho que não é número não vira banco 0 em silêncio', () => {
  assert.match(erroDe(url('redis://h/abc')), /número do banco/);
});

test('URL vazia e ilegível têm mensagens próprias', () => {
  assert.match(erroDe(url('  ')), /vazia/);
  assert.match(erroDe(url('nao é url')), /redis:\/\/usuario:senha@host/);
});

// ---------------------------------------------------------------------------
// Qual forma vence
// ---------------------------------------------------------------------------

test('a URL vence quando o modo é url, e NÃO se mistura com os campos', () => {
  // Host da URL com senha do campo daria uma combinação que não existe em lugar
  // nenhum, e o erro viria como "autenticação falhou" sem explicação.
  const d = destDe(destinoDaConexao({
    modo: 'url', url: 'redis://:a@urlhost:6379', host: 'outro', password: 'b',
  }));
  assert.equal((d as { host: string }).host, 'urlhost');
  assert.equal((d as { senha: string }).senha, 'a');
});

test('no modo campos, host vazio é recusado com instrução', () => {
  assert.match(erroDe(destinoDaConexao({ modo: 'campos', host: '  ' })), /modo URL/);
});

test('porta e banco inválidos nos campos são recusados', () => {
  assert.match(erroDe(destinoDaConexao({ modo: 'campos', host: 'h', port: '99999' })), /Porta/);
  assert.match(erroDe(destinoDaConexao({ modo: 'campos', host: 'h', database: '-1' })), /Banco/);
});

// ---------------------------------------------------------------------------
// TLS e standalone (pedidos dele)
// ---------------------------------------------------------------------------

test('a marca de TLS SOMA com o esquema, e nunca subtrai', () => {
  // `rediss://` já é TLS, e uma caixa desmarcada não pode rebaixar isso em
  // silêncio — seria a IDE decidindo mandar a senha em claro.
  const comEsquema = destDe(destinoDaConexao({
    modo: 'url', url: 'rediss://h:6379', tls: false,
  })) as { tls: boolean };
  assert.equal(comEsquema.tls, true, 'rediss:// mantém o TLS mesmo com a caixa desmarcada');

  const soPelaMarca = destDe(destinoDaConexao({
    modo: 'url', url: 'redis://h:6379', tls: true,
  })) as { tls: boolean };
  assert.equal(soPelaMarca.tls, true, 'a marca liga o TLS mesmo com redis://');
});

test('nos campos separados, o TLS vem só da marca', () => {
  const d = destDe(destinoDaConexao({ modo: 'campos', host: 'h', tls: true })) as { tls: boolean };
  assert.equal(d.tls, true);
  const sem = destDe(destinoDaConexao({ modo: 'campos', host: 'h' })) as { tls: boolean };
  assert.equal(sem.tls, false);
});

test('a marca de standalone atravessa as duas formas', () => {
  const porUrl = destDe(destinoDaConexao({
    modo: 'url', url: 'redis://h', standalone: true,
  })) as { standalone: boolean };
  assert.equal(porUrl.standalone, true);

  const porCampos = destDe(destinoDaConexao({
    modo: 'campos', host: 'h', standalone: 'true',
  })) as { standalone: boolean };
  assert.equal(porCampos.standalone, true);
});

test('a MARCA vence a detecção de cluster', () => {
  // Quem liga o standalone está dizendo "este endereço é um túnel ou um
  // balanceador — não vá atrás dos outros nós". Deixar a detecção ganhar
  // transformaria a opção em enfeite.
  assert.equal(modoDeConexao(true, true), 'standalone');
  assert.equal(modoDeConexao(true, false), 'standalone');
});

test('sem a marca, o servidor decide', () => {
  assert.equal(modoDeConexao(false, true), 'cluster');
  assert.equal(modoDeConexao(false, false), 'standalone');
});
