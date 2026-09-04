// O cliente de linha de comando do Redis.
//
// O que se prova aqui é que a SENHA nunca aparece em `argv` — que é a razão de
// este módulo existir.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLI_REDIS } from '../terminal/clientes/redis';
import { montarComando } from '../terminal/comando';

const CAMPOS = {
  modo: 'campos', host: 'servidor-1', port: 6380, username: 'leitor',
  password: 'segredo', database: 3, tls: true,
};

function montar(fields: Record<string, string | number | boolean>) {
  return montarComando(
    CLI_REDIS,
    { fields, readOnly: false, arquivoDeCredencial: null },
    String(fields.password ?? ''),
    ['password', 'url']
  );
}

test('a senha vai no AMBIENTE, e nunca em argv', () => {
  const c = montar(CAMPOS)!;
  assert.equal(c.env.REDISCLI_AUTH, 'segredo');
  assert.ok(!c.args.includes('segredo'), `senha em argv: ${c.args.join(' ')}`);
  assert.ok(!c.args.some((a) => a === '-a' || a === '--pass'));
});

test('sem arquivo de credencial — o redis-cli não tem um', () => {
  assert.equal(montar(CAMPOS)!.credencial, null);
});

test('host, porta, banco, usuário e TLS viram argumentos', () => {
  const args = montar(CAMPOS)!.args;
  assert.deepEqual(args, ['-h', 'servidor-1', '-p', '6380', '-n', '3', '--user', 'leitor', '--tls']);
});

test('usuário VAZIO não vira `--user default`', () => {
  // Há servidor que só tem senha; mandar um usuário que não existe derruba a
  // autenticação. É a mesma regra que o driver já segue.
  const args = montar({ ...CAMPOS, username: '' })!.args;
  assert.ok(!args.includes('--user'), args.join(' '));
});

test('no modo URL o endereço manda sozinho', () => {
  // Repetir os campos faria o redis-cli receber dois endereços na mesma chamada.
  const c = montar({ ...CAMPOS, modo: 'url', url: 'redis://servidor-1:6379/0' })!;
  assert.deepEqual(c.args, ['-u', 'redis://servidor-1:6379/0']);
});

test('sem senha, nada de REDISCLI_AUTH em branco no ambiente', () => {
  const c = montar({ ...CAMPOS, password: '' })!;
  assert.equal('REDISCLI_AUTH' in c.env, false);
});

test('TLS desligado não vira `--tls`', () => {
  assert.ok(!montar({ ...CAMPOS, tls: false })!.args.includes('--tls'));
});

test('a URL perde a CREDENCIAL antes de virar argumento', () => {
  const c = montar({
    modo: 'url', url: 'rediss://usuario:segredo@servidor-1:6380/2', password: 'segredo',
  })!;
  const linha = c.args.join(' ');
  assert.ok(!linha.includes('segredo'), `credencial em argv: ${linha}`);
  assert.ok(!linha.includes('usuario'), linha);
  assert.ok(linha.includes('servidor-1:6380'), `perdeu o endereço: ${linha}`);
  assert.equal(c.env.REDISCLI_AUTH, 'segredo', 'a senha vai pelo ambiente');
});

test('URL ilegível não vira argumento cru', () => {
  const c = montar({ modo: 'url', url: 'isto não é uma url', password: 'x' })!;
  assert.ok(!c.args.join(' ').includes('isto'), c.args.join(' '));
});
