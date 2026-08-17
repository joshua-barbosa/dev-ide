import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RememberedKey, diasDeLembranca, restaurarCofre } from '../connections/remember';

const CHAVE = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes
const MAQUINA = () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function tempPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-rem-')), 'session.json');
}

function nova(file = tempPath(), machineId = MAQUINA): RememberedKey {
  return new RememberedKey(file, machineId);
}

// ---- ida e volta ----

test('grava e relê a mesma chave', () => {
  const r = nova();
  r.save(CHAVE, 15);
  assert.deepEqual(r.load(), CHAVE);
});

test('sem arquivo, não há lembrança', () => {
  assert.equal(nova().load(), null);
});

test('grava o arquivo como 600 dentro de um diretório 700', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-rem-perm-'));
  const file = path.join(dir, 'sub', 'session.json');
  nova(file).save(CHAVE, 15);

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
});

test('a chave não aparece em claro no arquivo gravado', () => {
  const file = tempPath();
  nova(file).save(CHAVE, 15);
  const cru = fs.readFileSync(file);

  assert.equal(cru.includes(CHAVE), false, 'chave em claro no arquivo');
  assert.equal(cru.toString('utf8').includes(CHAVE.toString('base64')), false);
});

// ---- amarra à máquina (AC-9, AC-10) ----

test('lembrança de outra máquina não abre', () => {
  const file = tempPath();
  nova(file, () => 'maquina-de-origem-aaaaaaaaaaaaaaa').save(CHAVE, 15);

  const outra = nova(file, () => 'maquina-de-destino-bbbbbbbbbbbbb');
  assert.equal(outra.load(), null);
});

test('sem machine-id, não oferece lembrança e não lança', () => {
  const file = tempPath();
  nova(file).save(CHAVE, 15);

  const semId = nova(file, () => { throw new Error('sem /etc/machine-id'); });
  assert.equal(semId.available(), false);
  assert.equal(semId.load(), null);
  assert.doesNotThrow(() => semId.save(CHAVE, 15));
});

// ---- vencimento (AC-5, AC-6) ----

test('lembrança vencida é recusada e apagada', () => {
  const file = tempPath();
  const r = nova(file);
  r.save(CHAVE, -1); // já nasceu vencida

  assert.equal(r.load(), null);
  assert.equal(fs.existsSync(file), false, 'a lembrança vencida deve sumir do disco');
});

test('esticar o prazo no arquivo faz a decifra recusar', () => {
  const file = tempPath();
  const r = nova(file);
  r.save(CHAVE, 1);

  const dados = JSON.parse(fs.readFileSync(file, 'utf8'));
  const daquiAUmAno = new Date(Date.parse(dados.expiresAt) + 365 * 86_400_000);
  dados.expiresAt = daquiAUmAno.toISOString();
  fs.writeFileSync(file, JSON.stringify(dados));

  // A data está no futuro; só a autenticação do GCM impede o golpe.
  assert.equal(r.load(), null);
});

test('trocar o texto cifrado também é recusado', () => {
  const file = tempPath();
  const r = nova(file);
  r.save(CHAVE, 15);

  const dados = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bytes = Buffer.from(dados.data, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  dados.data = bytes.toString('base64');
  fs.writeFileSync(file, JSON.stringify(dados));

  assert.equal(r.load(), null);
});

// ---- tolerância a lixo (AC-10) ----

test('arquivo corrompido não derruba nada', () => {
  for (const lixo of ['', 'não é json', '{}', '{"version":1}', '[]', 'null']) {
    const file = tempPath();
    fs.writeFileSync(file, lixo);
    const r = nova(file);
    assert.equal(r.load(), null, `deveria ignorar: ${JSON.stringify(lixo)}`);
  }
});

test('versão desconhecida é ignorada', () => {
  const file = tempPath();
  nova(file).save(CHAVE, 15);
  const dados = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...dados, version: 99 }));

  assert.equal(nova(file).load(), null);
});

// ---- remoção (AC-7) ----

test('clear apaga a lembrança e é idempotente', () => {
  const file = tempPath();
  const r = nova(file);
  r.save(CHAVE, 15);

  r.clear();
  assert.equal(fs.existsSync(file), false);
  assert.doesNotThrow(() => r.clear());
  assert.equal(r.load(), null);
});

// ---- validade informada (AC-12) ----

test('informa até quando a lembrança vale', () => {
  const r = nova();
  assert.equal(r.validUntil(), null);

  r.save(CHAVE, 15);
  const ate = r.validUntil();
  assert.ok(ate !== null);
  const dias = (Date.parse(ate) - Date.now()) / 86_400_000;
  assert.ok(dias > 14.9 && dias <= 15, `esperava ~15 dias, veio ${dias}`);
});

test('validUntil não devolve data de lembrança vencida', () => {
  const r = nova();
  r.save(CHAVE, -1);
  assert.equal(r.validUntil(), null);
});

// ---- prazo configurável (AC-4) ----

test('o prazo padrão é de 15 dias', () => {
  assert.equal(diasDeLembranca({}), 15);
});

test('a variável de ambiente define o prazo', () => {
  assert.equal(diasDeLembranca({ DEV_IDE_VAULT_REMEMBER_DAYS: '30' }), 30);
  assert.equal(diasDeLembranca({ DEV_IDE_VAULT_REMEMBER_DAYS: '1' }), 1);
});

test('valor inválido no ambiente cai no padrão em vez de quebrar', () => {
  for (const valor of ['0', '-5', 'quinze', '', '  ', '1.5', 'NaN', 'Infinity']) {
    assert.equal(diasDeLembranca({ DEV_IDE_VAULT_REMEMBER_DAYS: valor }), 15, `valor: ${valor}`);
  }
});

// ---- restauração na subida do servidor (AC-2, AC-5, AC-8) ----

/** Cofre mínimo, com o comportamento que importa: chave certa abre, errada lança. */
function cofreFalso(chaveCerta: Buffer, existe = true) {
  let destrancado = false;
  return {
    exists: () => existe,
    unlockWithKey(k: Buffer) {
      if (!k.equals(chaveCerta)) throw new Error('Chave de cofre inválida.');
      destrancado = true;
    },
    get destrancado() { return destrancado; },
  };
}

test('destranca na subida quando há lembrança válida', () => {
  const r = nova();
  r.save(CHAVE, 15);
  const cofre = cofreFalso(CHAVE);

  assert.equal(restaurarCofre(cofre, r), true);
  assert.equal(cofre.destrancado, true);
});

test('sobe trancado quando não há lembrança', () => {
  const cofre = cofreFalso(CHAVE);
  assert.equal(restaurarCofre(cofre, nova()), false);
  assert.equal(cofre.destrancado, false);
});

test('sobe trancado quando a lembrança venceu', () => {
  const r = nova();
  r.save(CHAVE, -1);
  const cofre = cofreFalso(CHAVE);
  assert.equal(restaurarCofre(cofre, r), false);
});

test('chave de cofre antigo é recusada e a lembrança some', () => {
  const file = tempPath();
  const r = nova(file);
  r.save(CHAVE, 15);
  // Senha trocada: o verificador do cofre mudou, a chave lembrada não abre mais.
  const cofre = cofreFalso(Buffer.from('ffffffffffffffffffffffffffffffff', 'utf8'));

  assert.equal(restaurarCofre(cofre, r), false);
  assert.equal(fs.existsSync(file), false, 'lembrança inútil deve ser descartada');
});

test('lembrança sem cofre correspondente é ignorada', () => {
  const r = nova();
  r.save(CHAVE, 15);
  assert.equal(restaurarCofre(cofreFalso(CHAVE, false), r), false);
});

test('lembrança corrompida não derruba a subida', () => {
  const file = tempPath();
  fs.writeFileSync(file, 'lixo que não é json');
  assert.doesNotThrow(() => restaurarCofre(cofreFalso(CHAVE), nova(file)));
});
