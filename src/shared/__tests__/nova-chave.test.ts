// O formulário de NOVA chave, antes de existir tela.
//
// Ele, em 08/09/2026: *"Ou adicionar uma nova chave"* — e criar chave não
// existia em lugar nenhum, nem na IDE. Escolheu o formulário
// (nome, tipo, valor, TTL) em vez do comando pronto para editar.
//
// A validação mora aqui, pura: é ela que decide o que a tela oferece e o que a
// rota aceita, e as duas precisam concordar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarNovaChave, EXEMPLO_DE_VALOR } from '../sql/nova-chave';

const base = { nome: 'acme:aluno:9', tipo: 'string' as const, valor: 'Ana', ttl: '' };

test('o caminho feliz vira o pedido que a rota espera', () => {
  const r = validarNovaChave({ ...base, banco: 'db3' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.pedido, { chave: 'acme:aluno:9', tipo: 'string', valor: 'Ana', banco: 'db3' });
});

test('nome vazio é recusado — e não vira uma chave chamada ""', () => {
  const r = validarNovaChave({ ...base, nome: '   ' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /nome/i);
});

test('espaço no nome é recusado: o Redis aceita, o resto da IDE não', () => {
  // `SCAN MATCH` e a árvore de prefixos partem do nome; um espaço passa no
  // servidor e depois some da árvore, que é pior que a recusa.
  const r = validarNovaChave({ ...base, nome: 'acme aluno' });
  assert.equal(r.ok, false);
});

test('valor vazio é recusado — gravar nada não é criar', () => {
  const r = validarNovaChave({ ...base, valor: '' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /valor/i);
});

test('JSON inválido é recusado ANTES de ir ao servidor', () => {
  // O `JSON.SET` recusaria também, mas com a mensagem do servidor, que fala de
  // sintaxe e não do campo. Aqui ele lê onde errou.
  const r = validarNovaChave({ ...base, tipo: 'ReJSON-RL', valor: '{nome: Ana}' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /JSON/i);
});

test('JSON válido passa, e vai inteiro', () => {
  const r = validarNovaChave({ ...base, tipo: 'ReJSON-RL', valor: '{"nome":"Ana"}' });
  assert.equal(r.ok, true);
});

test('hash sem nenhum `campo=valor` é recusado', () => {
  const r = validarNovaChave({ ...base, tipo: 'hash', valor: 'só um texto solto' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /=/);
});

test('hash com pares passa', () => {
  const r = validarNovaChave({ ...base, tipo: 'hash', valor: 'nome=Ana\nsala=12' });
  assert.equal(r.ok, true);
});

test('zset exige `membro=nota`, e a nota tem de ser número', () => {
  assert.equal(validarNovaChave({ ...base, tipo: 'zset', valor: 'ana=10' }).ok, true);
  assert.equal(validarNovaChave({ ...base, tipo: 'zset', valor: 'ana=alta' }).ok, false);
});

test('TTL vazio é "sem prazo", e não vai no pedido', () => {
  const r = validarNovaChave({ ...base, ttl: '' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal('ttl' in r.pedido, false);
});

test('TTL vira número de segundos', () => {
  const r = validarNovaChave({ ...base, ttl: '3600' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.pedido.ttl, 3600);
});

test('TTL zero ou negativo é recusado — apagaria a chave na hora', () => {
  assert.equal(validarNovaChave({ ...base, ttl: '0' }).ok, false);
  assert.equal(validarNovaChave({ ...base, ttl: '-5' }).ok, false);
  assert.equal(validarNovaChave({ ...base, ttl: 'daqui a pouco' }).ok, false);
});

test('cada tipo tem um exemplo de valor, e o exemplo é válido', () => {
  // O campo nasce com o exemplo do tipo escolhido: sem ele, `hash` e `zset`
  // pedem um formato que ninguém adivinha.
  for (const [tipo, exemplo] of Object.entries(EXEMPLO_DE_VALOR)) {
    assert.equal(
      validarNovaChave({ ...base, tipo: tipo as 'string', valor: exemplo }).ok,
      true,
      `o exemplo de ${tipo} não passa na própria validação`
    );
  }
});
