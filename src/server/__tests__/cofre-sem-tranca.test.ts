// O cofre SEM TRANCA (spec 109).
//
// Ele: *"toda vez que fecha o Cursor, precisa digitar de novo, está sendo muito
// inconveniente, eu acho que é melhor remover essa senha mesmo e deixar sempre
// aberto, não ter essa tranca, porque fica muito chato precisar ficar
// digitando"*. Decisão dele, tomada depois de eu mostrar as três saídas.
//
// O que estes testes protegem é o que a decisão NÃO inclui: as senhas de banco
// não passam a ficar em texto puro. A chave fica embrulhada pela identidade da
// máquina — copiar a pasta para outro computador não abre.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Vault } from '../connections/vault';
import type { ConnectionInput } from '../connections/types';

const SENHA = 'senha-mestra-de-teste';
const MAQUINA = () => 'maquina-de-teste-0001';
const OUTRA_MAQUINA = () => 'outra-maquina-9999';

function caminho(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-sem-tranca-')), 'vault.json');
}

const CONEXAO: ConnectionInput = {
  type: 'mysql',
  label: 'servidor-de-exemplo',
  group: 'Exemplos',
  readOnly: true,
  fields: { host: '127.0.0.1', port: 3306, user: 'root', password: 'senha-inventada' },
};

test('cofre criado sem tranca já nasce aberto', () => {
  const vault = new Vault(caminho(), MAQUINA);
  vault.criarSemTranca();
  assert.equal(vault.exists(), true);
  assert.equal(vault.isUnlocked(), true);
  assert.equal(vault.semTranca(), true);
});

test('um motor NOVO abre o cofre sem tranca sozinho — é o ponto todo', () => {
  const onde = caminho();
  const primeiro = new Vault(onde, MAQUINA);
  primeiro.criarSemTranca();
  primeiro.add(CONEXAO, ['password']);

  // Fechar o Cursor e abrir de novo: outro processo, outro `Vault`.
  const segundo = new Vault(onde, MAQUINA);
  assert.equal(segundo.isUnlocked(), false, 'antes de abrir, está fechado');
  assert.equal(segundo.abrirSemSenha(), true);
  assert.equal(segundo.isUnlocked(), true);
  assert.equal(segundo.resolve(segundo.list()[0].id).fields.password, 'senha-inventada');
});

test('a senha do banco NÃO fica em texto puro no arquivo', () => {
  const onde = caminho();
  const vault = new Vault(onde, MAQUINA);
  vault.criarSemTranca();
  vault.add(CONEXAO, ['password']);
  const bruto = fs.readFileSync(onde, 'utf8');
  assert.ok(!bruto.includes('senha-inventada'), 'o segredo apareceu em claro');
});

test('levado para outra máquina, o cofre sem tranca NÃO abre', () => {
  const onde = caminho();
  const daqui = new Vault(onde, MAQUINA);
  daqui.criarSemTranca();
  daqui.add(CONEXAO, ['password']);

  const noutra = new Vault(onde, OUTRA_MAQUINA);
  assert.equal(noutra.abrirSemSenha(), false);
  assert.equal(noutra.isUnlocked(), false);
});

test('sem identidade de máquina (Windows), a chave fica em claro — e o cofre DIZ isso', () => {
  // Não é para esconder: é a consequência de "sempre aberto" onde não há
  // amarra possível. A tela mostra o aviso; aqui se garante que o estado conta.
  const vault = new Vault(caminho(), () => '');
  vault.criarSemTranca();
  assert.equal(vault.isUnlocked(), true);
  assert.equal(vault.chaveDesprotegida(), true);
});

test('tirar a tranca de um cofre COM senha guarda os segredos', () => {
  const onde = caminho();
  const vault = new Vault(onde, MAQUINA);
  vault.create(SENHA);
  vault.add(CONEXAO, ['password']);

  vault.removerTranca(SENHA);
  assert.equal(vault.semTranca(), true);

  const depois = new Vault(onde, MAQUINA);
  depois.abrirSemSenha();
  assert.equal(depois.resolve(depois.list()[0].id).fields.password, 'senha-inventada');
});

test('tirar a tranca com a senha errada não mexe em nada', () => {
  const onde = caminho();
  const vault = new Vault(onde, MAQUINA);
  vault.create(SENHA);
  assert.throws(() => vault.removerTranca('senha-errada'), /incorreta/i);
  assert.equal(vault.semTranca(), false);
});

test('pôr a tranca de volta: a senha volta a ser exigida', () => {
  const onde = caminho();
  const vault = new Vault(onde, MAQUINA);
  vault.criarSemTranca();
  vault.add(CONEXAO, ['password']);

  vault.porTranca('senha-nova-1234');
  assert.equal(vault.semTranca(), false);

  const depois = new Vault(onde, MAQUINA);
  assert.equal(depois.abrirSemSenha(), false, 'não abre mais sozinho');
  assert.throws(() => depois.unlock('senha-errada'), /incorreta/i);
  depois.unlock('senha-nova-1234');
  assert.equal(depois.resolve(depois.list()[0].id).fields.password, 'senha-inventada');
});

test('cofre sem tranca recusa destrancar por senha, com recado claro', () => {
  const vault = new Vault(caminho(), MAQUINA);
  vault.criarSemTranca();
  assert.throws(() => vault.unlock(SENHA), /não tem senha/i);
});

test('trancar um cofre sem tranca não deixa ninguém para fora', () => {
  // `lock()` existe para a IDE; num cofre sem tranca ele não pode virar uma
  // porta sem chave — reabrir é sozinho.
  const vault = new Vault(caminho(), MAQUINA);
  vault.criarSemTranca();
  vault.lock();
  assert.equal(vault.abrirSemSenha(), true);
});
