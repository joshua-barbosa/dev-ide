import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMPOS_SSH,
  lerConfigSsh,
  listaDeAlgoritmos,
  PORTA_PADRAO,
} from '../connections/drivers/ssh-campos';
import {
  explicarFalhaDeHandshake,
  lerDistribuicao,
  lerOfertaDoServidor,
  sistemaDe,
} from '../connections/drivers/ssh-diagnostico';
import { camposVisiveis } from '../../shared/connections/form';

// ---------------------------------------------------------------------------
// Os campos
// ---------------------------------------------------------------------------

test('cada modo de Auth mostra só o que ele usa', () => {
  const nomes = (auth: string) =>
    camposVisiveis(CAMPOS_SSH, { auth })
      .filter((c) => c.section === undefined)
      .map((c) => c.name);

  assert.deepEqual(nomes('password'), ['host', 'port', 'username', 'auth', 'password']);
  assert.deepEqual(nomes('key'), [
    'host', 'port', 'username', 'auth', 'private_key_path', 'passphrase',
  ]);
  assert.deepEqual(nomes('agent'), ['host', 'port', 'username', 'auth', 'agent_path']);
  // `auto` tenta o que houver, então mostra senha E chave.
  assert.deepEqual(nomes('auto'), [
    'host', 'port', 'username', 'auth', 'password', 'private_key_path', 'passphrase',
  ]);
});

test('senha e passphrase são as ÚNICAS secretas', () => {
  const secretos = CAMPOS_SSH.filter((c) => c.secret === true).map((c) => c.name);
  assert.deepEqual(secretos.sort(), ['passphrase', 'password']);
});

test('o caminho da chave NÃO é secreto — caminho não é credencial', () => {
  assert.equal(CAMPOS_SSH.find((c) => c.name === 'private_key_path')?.secret, undefined);
});

test('os três campos de algoritmo existem, e ficam fora da seção principal', () => {
  for (const nome of ['cipher', 'kex', 'host_key']) {
    const campo = CAMPOS_SSH.find((c) => c.name === nome);
    assert.equal(campo?.section, 'Algoritmo', nome);
    assert.equal(campo?.default, undefined, `${nome} tem que nascer vazio`);
  }
});

// ---------------------------------------------------------------------------
// Ler a configuração
// ---------------------------------------------------------------------------

test('os padrões da tela de referência', () => {
  const c = lerConfigSsh({ host: 'srv' });
  assert.equal(c.port, PORTA_PADRAO);
  assert.equal(c.username, 'root');
  assert.equal(c.auth, 'password');
  assert.equal(c.rootPath, '/');
  assert.equal(c.pruneRoot, false);
  // Ocultos LIGADO por padrão: quem abre servidor por SSH costuma estar atrás
  // de `.env` e `.gitignore`.
  assert.equal(c.showHidden, true);
});

test('a raiz é normalizada na leitura, e não na hora de usar', () => {
  // Ela é o chão de toda comparação da cerca: uma raiz com `//` faria a cerca
  // comparar com um caminho que o servidor não tem.
  assert.equal(lerConfigSsh({ root_path: '/srv//app/' }).rootPath, '/srv/app');
  assert.equal(lerConfigSsh({ root_path: '' }).rootPath, '/');
});

test('porta inválida cai no padrão em vez de virar NaN', () => {
  assert.equal(lerConfigSsh({ port: 'abc' }).port, PORTA_PADRAO);
  assert.equal(lerConfigSsh({ port: 0 }).port, PORTA_PADRAO);
  assert.equal(lerConfigSsh({ port: 2242 }).port, 2242);
});

test('campo em branco vira AUSENTE, não string vazia', () => {
  const c = lerConfigSsh({ password: '   ', private_key_path: '' });
  assert.equal(c.password, undefined);
  assert.equal(c.privateKeyPath, undefined);
});

test('algoritmo em branco é AUSÊNCIA, e não lista vazia', () => {
  // As duas coisas são diferentes para o `ssh2`: ausência mantém o padrão dele,
  // lista vazia desabilitaria tudo e nenhuma conexão fecharia.
  assert.equal(listaDeAlgoritmos(''), undefined);
  assert.equal(listaDeAlgoritmos('   '), undefined);
  assert.equal(listaDeAlgoritmos(undefined), undefined);
  assert.deepEqual(listaDeAlgoritmos('aes128-ctr, aes256-ctr'), ['aes128-ctr', 'aes256-ctr']);
  assert.deepEqual(listaDeAlgoritmos('ssh-rsa  ssh-dss'), ['ssh-rsa', 'ssh-dss']);
});

// ---------------------------------------------------------------------------
// O erro que se explica (D21)
// ---------------------------------------------------------------------------

test('falha de negociação vira texto que diz o que fazer', () => {
  const texto = explicarFalhaDeHandshake(
    'Handshake failed: no matching key exchange algorithm'
  );
  assert.notEqual(texto, null);
  assert.match(texto ?? '', /algoritmo em comum/);
  assert.match(texto ?? '', /Algoritmo/);
  // A mensagem original continua lá: ela é o que se pesquisa.
  assert.match(texto ?? '', /no matching key exchange algorithm/);
});

test('senha errada NÃO vira lição sobre algoritmos', () => {
  // Cobrir um erro bom com um texto sobre outra coisa manda o usuário para o
  // lugar errado, e isso é pior que não dizer nada.
  assert.equal(explicarFalhaDeHandshake('All configured authentication methods failed'), null);
  assert.equal(explicarFalhaDeHandshake('connect ECONNREFUSED 10.0.0.1:22'), null);
  assert.equal(explicarFalhaDeHandshake('Timed out while waiting for handshake'), null);
});

test('quando a depuração diz o que o servidor ofereceu, o erro repete', () => {
  const texto = explicarFalhaDeHandshake('Handshake failed: no matching cipher', [
    'Handshake: (remote) KEX method: diffie-hellman-group14-sha1,diffie-hellman-group1-sha1',
    'Handshake: (remote) Host key: ssh-rsa,ssh-dss',
  ]);
  assert.match(texto ?? '', /diffie-hellman-group14-sha1/);
  assert.match(texto ?? '', /ssh-rsa/);
});

test('depuração ilegível não estraga o erro — só o deixa mais curto', () => {
  const oferta = lerOfertaDoServidor(['linha sem nada de útil', '']);
  assert.deepEqual(oferta, { kex: undefined, serverHostKey: undefined, cipher: undefined });
  assert.notEqual(explicarFalhaDeHandshake('no matching mac found', []), null);
});

// ---------------------------------------------------------------------------
// Que servidor é (AC-11)
// ---------------------------------------------------------------------------

test('a distribuição sai do PRETTY_NAME, sem as aspas', () => {
  // Verificado contra o servidor real do usuário em 2026-08-24.
  const real = 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nNAME="Debian GNU/Linux"\nID=debian';
  assert.equal(lerDistribuicao(real), 'Debian GNU/Linux 13 (trixie)');
  assert.equal(lerDistribuicao('PRETTY_NAME="Ubuntu 24.04.2 LTS"'), 'Ubuntu 24.04.2 LTS');
});

test('sem PRETTY_NAME devolve null, e não um "Linux" inventado', () => {
  assert.equal(lerDistribuicao('NAME="Alpine Linux"'), null);
  assert.equal(lerDistribuicao(''), null);
});

test('o sistema sai do uname', () => {
  assert.equal(sistemaDe('Linux\n'), 'linux');
  assert.equal(sistemaDe('Darwin'), 'macos');
  assert.equal(sistemaDe('MINGW64_NT-10.0'), 'windows');
  assert.equal(sistemaDe('SunOS'), 'desconhecido');
});
