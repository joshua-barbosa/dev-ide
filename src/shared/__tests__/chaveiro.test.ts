// A política do chaveiro do sistema (T099).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aposFalharComAChave, comoAbrir, valeGuardarAChave, type EstadoDoChaveiro,
} from '../chaveiro';

const base: EstadoDoChaveiro = {
  cofreExiste: true,
  chaveiroDisponivel: true,
  temChaveGuardada: true,
  desligadoPorEle: false,
};

test('sem cofre, o caminho é CRIAR — e não pedir senha de nada', () => {
  assert.equal(comoAbrir({ ...base, cofreExiste: false }).tipo, 'criar');
});

test('a escolha DELE vem antes da conveniência', () => {
  // Alguém que compartilha a máquina pode preferir digitar toda vez.
  const r = comoAbrir({ ...base, desligadoPorEle: true });
  assert.equal(r.tipo, 'senha');
  assert.match(r.tipo === 'senha' ? r.motivo : '', /desligado nas preferências/);
});

test('no navegador não há chaveiro, e o motivo diz isso', () => {
  const r = comoAbrir({ ...base, chaveiroDisponivel: false });
  assert.equal(r.tipo, 'senha');
  assert.match(r.tipo === 'senha' ? r.motivo : '', /libsecret|navegador/);
});

test('a chave só é guardada DEPOIS de uma abertura que deu certo', () => {
  // Guardar antes seria guardar uma chave que talvez não abra nada.
  const r = comoAbrir({ ...base, temChaveGuardada: false });
  assert.equal(r.tipo, 'senha');
  assert.match(r.tipo === 'senha' ? r.motivo : '', /DEPOIS de/);
});

test('com tudo no lugar, abre pelo chaveiro', () => {
  assert.equal(comoAbrir(base).tipo, 'chaveiro');
});

test('chave que não abre mais: cai para a senha E é ESQUECIDA', () => {
  // Acontece de verdade — senha trocada noutra máquina, cofre restaurado de
  // backup. Manter a chave velha faria o mesmo tropeço em toda inicialização.
  const r = aposFalharComAChave();
  assert.equal(r.proximo.tipo, 'senha');
  assert.equal(r.esquecerChave, true);
  assert.match(r.proximo.tipo === 'senha' ? r.proximo.motivo : '', /outra máquina|senha mestra/);
});

test('não vale guardar chave onde não dá para lê-la depois', () => {
  assert.equal(valeGuardarAChave(base), true);
  assert.equal(valeGuardarAChave({ ...base, chaveiroDisponivel: false }), false);
  assert.equal(valeGuardarAChave({ ...base, desligadoPorEle: true }), false);
});

test('o chaveiro é ATALHO: nenhum caminho fecha a porta da senha', () => {
  // A regra que governa o arquivo inteiro. Um cofre que só abre pelo chaveiro
  // se perde quando o sistema é reinstalado.
  const casos: EstadoDoChaveiro[] = [
    { ...base, chaveiroDisponivel: false },
    { ...base, temChaveGuardada: false },
    { ...base, desligadoPorEle: true },
  ];
  for (const c of casos) assert.equal(comoAbrir(c).tipo, 'senha');
});
