import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Vault } from '../connections/vault';
import type { ConnectionInput } from '../connections/types';

const SENHA = 'senha-mestra-de-teste';
const SEGREDOS = ['password'];

function tempVaultPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-vault-')), 'vault.json');
}

function novoVault(): Vault {
  const vault = new Vault(tempVaultPath());
  vault.create(SENHA);
  return vault;
}

const CONEXAO: ConnectionInput = {
  type: 'mysql',
  label: 'servidor-2',
  group: 'ACME/Bancos',
  readOnly: true,
  fields: { host: '191.232.39.16', port: 3306, user: 'root', password: 'p4ssw0rd-secreta' },
};

// ---- ciclo de vida ----

test('cria o cofre e o deixa destrancado', () => {
  const vault = novoVault();
  assert.equal(vault.exists(), true);
  assert.equal(vault.isUnlocked(), true);
});

test('recusa criar sobre um cofre existente', () => {
  const vault = novoVault();
  assert.throws(() => vault.create(SENHA), /já existe/i);
});

test('destranca com a senha correta e recusa a errada', () => {
  const file = tempVaultPath();
  new Vault(file).create(SENHA);

  const errado = new Vault(file);
  assert.throws(() => errado.unlock('senha-errada'), /senha/i);
  assert.equal(errado.isUnlocked(), false);

  const certo = new Vault(file);
  certo.unlock(SENHA);
  assert.equal(certo.isUnlocked(), true);
});

// ---- segredos ----

test('resolve devolve o segredo decifrado', () => {
  const vault = novoVault();
  const criada = vault.add(CONEXAO, SEGREDOS);
  const resolvida = vault.resolve(criada.id);
  assert.equal(resolvida.fields.password, 'p4ssw0rd-secreta');
  assert.equal(resolvida.fields.host, '191.232.39.16');
  assert.equal(resolvida.readOnly, true);
});

test('list e get nunca devolvem segredos', () => {
  const vault = novoVault();
  const criada = vault.add(CONEXAO, SEGREDOS);

  for (const conexao of [vault.list()[0], vault.get(criada.id)]) {
    assert.equal(conexao.fields.password, undefined);
    assert.equal(conexao.fields.host, '191.232.39.16');
    assert.deepEqual(conexao.secretFields, ['password']);
  }
});

test('o segredo não aparece em claro no arquivo', () => {
  const file = tempVaultPath();
  const vault = new Vault(file);
  vault.create(SENHA);
  vault.add(CONEXAO, SEGREDOS);

  const conteudo = fs.readFileSync(file, 'utf8');
  assert.ok(!conteudo.includes('p4ssw0rd-secreta'), 'senha vazou em claro no vault.json');
  assert.ok(conteudo.includes('191.232.39.16'), 'host deveria ficar em claro');
});

// ---- cofre trancado ----

test('a árvore renderiza trancada: list funciona, resolve não', () => {
  const file = tempVaultPath();
  const aberto = new Vault(file);
  aberto.create(SENHA);
  const criada = aberto.add(CONEXAO, SEGREDOS);

  const trancado = new Vault(file);
  assert.equal(trancado.isUnlocked(), false);

  const lista = trancado.list();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].label, 'servidor-2');
  assert.equal(lista[0].group, 'ACME/Bancos');

  assert.throws(() => trancado.resolve(criada.id), /trancado/i);
});

test('adicionar conexão com segredo exige cofre destrancado', () => {
  const file = tempVaultPath();
  new Vault(file).create(SENHA);
  const trancado = new Vault(file);
  assert.throws(() => trancado.add(CONEXAO, SEGREDOS), /trancado/i);
});

// ---- persistência ----

test('persiste entre instâncias', () => {
  const file = tempVaultPath();
  const primeiro = new Vault(file);
  primeiro.create(SENHA);
  const criada = primeiro.add(CONEXAO, SEGREDOS);

  const segundo = new Vault(file);
  segundo.unlock(SENHA);
  assert.equal(segundo.resolve(criada.id).fields.password, 'p4ssw0rd-secreta');
});

test('atualiza e remove conexões', () => {
  const vault = novoVault();
  const criada = vault.add(CONEXAO, SEGREDOS);

  const renomeada = vault.update(criada.id, { label: 'servidor-2-prod', group: 'ACME' }, SEGREDOS);
  assert.equal(renomeada.label, 'servidor-2-prod');
  assert.equal(renomeada.group, 'ACME');
  assert.equal(vault.resolve(criada.id).fields.password, 'p4ssw0rd-secreta', 'segredo deve sobreviver');

  const comNovaSenha = vault.update(criada.id, { fields: { ...CONEXAO.fields, password: 'nova' } }, SEGREDOS);
  assert.deepEqual(comNovaSenha.secretFields, ['password']);
  assert.equal(vault.resolve(criada.id).fields.password, 'nova');

  vault.remove(criada.id);
  assert.deepEqual(vault.list(), []);
  assert.throws(() => vault.get(criada.id), /não encontrada/i);
});

test('editar campos sem repetir o segredo preserva o segredo', () => {
  // Caso real: o usuário faz PATCH para ajustar ssl_mode/main_database e não
  // reenvia a senha. Perder o segredo aqui seria silencioso e destrutivo.
  const vault = novoVault();
  const criada = vault.add(CONEXAO, SEGREDOS);

  const atualizada = vault.update(
    criada.id,
    { fields: { host: '191.232.39.16', port: 3306, user: 'root', ssl_mode: 'REQUIRED' } },
    SEGREDOS
  );

  assert.deepEqual(atualizada.secretFields, ['password'], 'o segredo deve continuar registrado');
  const resolvida = vault.resolve(criada.id);
  assert.equal(resolvida.fields.password, 'p4ssw0rd-secreta');
  assert.equal(resolvida.fields.ssl_mode, 'REQUIRED');
});

test('enviar o campo secreto vazio também preserva o valor guardado', () => {
  // A UI manda "" quando o usuário não digita nada no campo de senha.
  const vault = novoVault();
  const criada = vault.add(CONEXAO, SEGREDOS);

  vault.update(criada.id, { fields: { ...CONEXAO.fields, password: '' } }, SEGREDOS);
  assert.equal(vault.resolve(criada.id).fields.password, 'p4ssw0rd-secreta');
});

// ---- integridade ----

test('detecta adulteração do texto cifrado', () => {
  const file = tempVaultPath();
  const vault = new Vault(file);
  vault.create(SENHA);
  const criada = vault.add(CONEXAO, SEGREDOS);

  const dados = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cifrado = dados.connections[0].secrets.password;
  const bytes = Buffer.from(cifrado.data, 'base64');
  bytes[0] ^= 0xff;
  cifrado.data = bytes.toString('base64');
  fs.writeFileSync(file, JSON.stringify(dados));

  const adulterado = new Vault(file);
  adulterado.unlock(SENHA);
  assert.throws(() => adulterado.resolve(criada.id), /adulterad|integridade/i);
});

test('impede mover um segredo de uma conexão para outra', () => {
  const file = tempVaultPath();
  const vault = new Vault(file);
  vault.create(SENHA);
  const alvo = vault.add(CONEXAO, SEGREDOS);
  const outra = vault.add({ ...CONEXAO, label: 'outra', fields: { ...CONEXAO.fields, password: 'zzz' } }, SEGREDOS);

  const dados = JSON.parse(fs.readFileSync(file, 'utf8'));
  const deAlvo = dados.connections.find((c: { id: string }) => c.id === alvo.id);
  const deOutra = dados.connections.find((c: { id: string }) => c.id === outra.id);
  deOutra.secrets.password = deAlvo.secrets.password; // rouba o blob cifrado
  fs.writeFileSync(file, JSON.stringify(dados));

  const adulterado = new Vault(file);
  adulterado.unlock(SENHA);
  assert.throws(() => adulterado.resolve(outra.id), /adulterad|integridade/i);
});

// ---- permissões ----

test('grava o cofre como 600 dentro de um diretório 700', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-perm-'));
  const file = path.join(dir, 'sub', 'vault.json');
  const vault = new Vault(file);
  vault.create(SENHA);
  vault.add(CONEXAO, SEGREDOS);

  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'vault.json deve ser 600');
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700, 'diretório deve ser 700');
});

// ---- chave exportada (base da lembrança, spec 004) ----

test('exporta a chave só com o cofre destrancado', () => {
  const file = tempVaultPath();
  new Vault(file).create(SENHA);

  const trancado = new Vault(file);
  assert.throws(() => trancado.exportKey(), /trancad/i);

  const aberto = new Vault(file);
  aberto.unlock(SENHA);
  assert.equal(aberto.exportKey().length, 32);
});

test('destranca com a chave exportada, sem a senha', () => {
  const file = tempVaultPath();
  const origem = new Vault(file);
  origem.create(SENHA);
  origem.add(CONEXAO, SEGREDOS);
  const chave = origem.exportKey();

  const destino = new Vault(file);
  destino.unlockWithKey(chave);
  assert.equal(destino.isUnlocked(), true);
  // Precisa decifrar de verdade, não só marcar como destrancado.
  assert.equal(destino.resolve(destino.list()[0]!.id).fields.password, 'p4ssw0rd-secreta');
});

test('recusa chave que não pertence ao cofre', () => {
  const outro = tempVaultPath();
  const alheio = new Vault(outro);
  alheio.create('outra-senha-mestra');

  const file = tempVaultPath();
  new Vault(file).create(SENHA);

  const alvo = new Vault(file);
  assert.throws(() => alvo.unlockWithKey(alheio.exportKey()), /chave/i);
  assert.equal(alvo.isUnlocked(), false);
});

test('recusa chave com tamanho errado', () => {
  const file = tempVaultPath();
  new Vault(file).create(SENHA);
  const alvo = new Vault(file);
  assert.throws(() => alvo.unlockWithKey(Buffer.alloc(16)), /chave/i);
});

// ---- Ver a senha guardada (N001) ----
//
// Ele pediu: "eu preciso pegar as senhas das conexões também". Até aqui o
// segredo ia do cofre direto para o driver e nunca passava pela tela.
//
// O que estes testes guardam é o ESTREITAMENTO: um campo por chamada, e pedir
// campo que não é segredo é ERRO — senão a rota viraria um jeito torto de ler
// campo comum, e um engano de uma linha despejaria tudo.

test('revelar devolve o segredo decifrado, um campo por vez', () => {
  const vault = novoVault();
  const c = vault.add(
    { type: 'mysql', label: 'x', group: '', readOnly: false, fields: { host: 'h', password: 'segredo-do-teste' } },
    ['password']
  );
  assert.equal(vault.revelar(c.id, 'password'), 'segredo-do-teste');
});

test('pedir campo que NÃO é segredo é erro, e não o valor em claro', () => {
  const vault = novoVault();
  const c = vault.add(
    { type: 'mysql', label: 'x', group: '', readOnly: false, fields: { host: 'h', password: 'p' } },
    ['password']
  );
  assert.throws(() => vault.revelar(c.id, 'host'), /não é um segredo/);
});

test('com o cofre trancado, revelar não revela nada', () => {
  const vault = novoVault();
  const c = vault.add(
    { type: 'mysql', label: 'x', group: '', readOnly: false, fields: { password: 'p' } },
    ['password']
  );
  vault.lock();
  assert.throws(() => vault.revelar(c.id, 'password'));
});

test('camposSecretos diz onde a tela põe o olho', () => {
  const vault = novoVault();
  const c = vault.add(
    {
      type: 'ssh', label: 'x', group: '', readOnly: false,
      fields: { host: 'h', password: 'p', passphrase: 'f' },
    },
    ['password', 'passphrase']
  );
  assert.deepEqual(vault.camposSecretos(c.id), ['passphrase', 'password']);
});

// ---- Trocar a senha mestra (T100) ----
//
// Não existia caminho nenhum para isso. Eu escrevi na spec 004 que "hoje não
// existe" e deixei assim por dois meses.

test('trocar a senha mestra mantém os segredos legíveis', () => {
  const vault = novoVault();
  const c = vault.add(CONEXAO, ['password']);
  vault.trocarSenhaMestra(SENHA, 'senha-nova-do-cofre');

  // A chave é DERIVADA da senha, então cada segredo foi recifrado. Se a
  // recifragem falhasse, isto viria adulterado em vez de vir errado.
  assert.equal(vault.revelar(c.id, 'password'), 'p4ssw0rd-secreta');
});

test('depois de trocar, a senha VELHA não abre mais', () => {
  const vault = novoVault();
  vault.add(CONEXAO, ['password']);
  vault.trocarSenhaMestra(SENHA, 'senha-nova-do-cofre');
  vault.lock();
  assert.throws(() => vault.unlock(SENHA), /incorreta/);
  vault.unlock('senha-nova-do-cofre');
});

test('a senha nova abre o cofre depois de reabrir o ARQUIVO', () => {
  // Reabrir prova que a troca foi ao disco, e não só à memória.
  const caminho = tempVaultPath();
  const primeiro = new Vault(caminho);
  primeiro.create(SENHA);
  const c = primeiro.add(CONEXAO, ['password']);
  primeiro.trocarSenhaMestra(SENHA, 'outra-senha');

  const segundo = new Vault(caminho);
  segundo.unlock('outra-senha');
  assert.equal(segundo.revelar(c.id, 'password'), 'p4ssw0rd-secreta');
});

test('senha atual errada não mexe em nada', () => {
  const vault = novoVault();
  const c = vault.add(CONEXAO, ['password']);
  assert.throws(() => vault.trocarSenhaMestra('errada', 'nova'), /incorreta/);
  // O cofre continua inteiro e com a senha de sempre — a conferência vem ANTES
  // de qualquer escrita, senão digitar errado reescreveria o arquivo.
  assert.equal(vault.revelar(c.id, 'password'), 'p4ssw0rd-secreta');
});

test('senha nova vazia é recusada', () => {
  const vault = novoVault();
  assert.throws(() => vault.trocarSenhaMestra(SENHA, '   '), /não pode ser vazia/);
});

test('o SAL muda junto com a senha', () => {
  const caminho = tempVaultPath();
  const vault = new Vault(caminho);
  vault.create(SENHA);
  const antes = JSON.parse(fs.readFileSync(caminho, 'utf8')) as { kdf: { salt: string } };
  vault.trocarSenhaMestra(SENHA, 'nova');
  const depois = JSON.parse(fs.readFileSync(caminho, 'utf8')) as { kdf: { salt: string } };
  // Reaproveitar o sal faria duas senhas diferentes compartilharem o trabalho
  // de derivação — que é exatamente o que o sal existe para evitar.
  assert.notEqual(antes.kdf.salt, depois.kdf.salt);
});
