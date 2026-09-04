import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  RememberedKey, diasDeLembranca, registrarSeloDoSistema, restaurarCofre,
} from '../connections/remember';
import { Vault } from '../connections/vault';
import { homeDeDados } from '../paths';

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

// ---- spec 011: o arquivo de preferências entra como padrão ----

test('sem ambiente, vale o prazo vindo do arquivo de preferências', () => {
  assert.equal(diasDeLembranca({}, 30), 30);
});

test('o ambiente vence o arquivo — é o que a suíte usa para isolar', () => {
  assert.equal(diasDeLembranca({ DEV_IDE_VAULT_REMEMBER_DAYS: '7' }, 30), 7);
});

test('ambiente inválido cai no valor do arquivo, não no padrão embutido', () => {
  assert.equal(diasDeLembranca({ DEV_IDE_VAULT_REMEMBER_DAYS: 'quinze' }, 30), 30);
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

// ---- isolamento dos caminhos (defeito real da spec 007) ----

test('uma raiz só governa todo o estado gravado', () => {
  // Nasceu de um defeito real: a suíte de ponta a ponta isolava o cofre por
  // `DEV_IDE_VAULT`, mas a lembrança tinha variável própria e ficou de fora —
  // rodar os testes apagava o `session.json` DO USUÁRIO.
  const anterior = process.env.DEV_IDE_HOME;
  process.env.DEV_IDE_HOME = '/tmp/dev-ide-raiz-de-teste';
  try {
    const raiz = homeDeDados();
    assert.equal(raiz, '/tmp/dev-ide-raiz-de-teste');

    // Todo caminho padrão precisa cair sob a raiz. Um arquivo novo que não
    // caia aqui vaza para o diretório do usuário, calado.
    for (const caminho of [Vault.defaultPath(), RememberedKey.defaultPath()]) {
      assert.ok(caminho.startsWith(`${raiz}/`), `fora da raiz de dados: ${caminho}`);
    }
  } finally {
    if (anterior === undefined) delete process.env.DEV_IDE_HOME;
    else process.env.DEV_IDE_HOME = anterior;
  }
});

test('sem a variável, a raiz é a pasta do usuário', () => {
  const anterior = process.env.DEV_IDE_HOME;
  delete process.env.DEV_IDE_HOME;
  try {
    assert.equal(homeDeDados(), path.join(os.homedir(), '.dev-ide'));
  } finally {
    if (anterior !== undefined) process.env.DEV_IDE_HOME = anterior;
  }
});

// ---- Prazo deslizante (T101) ----
//
// Eu tinha recusado dizendo que renovar a cada uso "faz 15 dias virarem para
// sempre para quem usa todos os dias". Isso é a DESCRIÇÃO da feature, não uma
// objeção — e quem some pelo prazo inteiro continua tendo que redigitar.

test('destrancar pela lembrança RENOVA o prazo', () => {
  const remember = nova();
  remember.save(CHAVE, 15);

  const antes = remember.validUntil();
  assert.ok(antes !== null);

  // Uma lembrança de 1 dia, para o novo prazo ser MENOR e a diferença não
  // poder vir de arredondamento.
  const cofre = {
    exists: () => true,
    unlockWithKey: () => undefined,
  };
  assert.equal(restaurarCofre(cofre, remember, 1), true);

  const depois = remember.validUntil();
  assert.ok(depois !== null);
  assert.notEqual(antes, depois);
  assert.ok(Date.parse(depois) < Date.parse(antes), `${depois} deveria ser antes de ${antes}`);
});

test('sem prazo informado, restaurar NÃO mexe na lembrança', () => {
  // É o caminho de quem chama só para saber se destrancou — e mudar o prazo
  // ali seria efeito colateral escondido.
  const remember = nova();
  remember.save(CHAVE, 15);
  const antes = remember.validUntil();

  restaurarCofre({ exists: () => true, unlockWithKey: () => undefined }, remember);
  assert.equal(remember.validUntil(), antes);
});

// ---------------------------------------------------------------------------
// O chaveiro do sistema como selo (T099)
// ---------------------------------------------------------------------------

/** Um selo de mentira, com a mesma forma do `safeStorage`. */
function seloFalso(dono = 'ana', disponivel = true) {
  return {
    disponivel: () => disponivel,
    selar: (texto: string) => Buffer.from(`${dono}|${texto}`, 'utf8'),
    abrir: (dados: Buffer) => {
      const [quem, ...resto] = dados.toString('utf8').split('|');
      if (quem !== dono) throw new Error('selo de outro dono');
      return resto.join('|');
    },
  };
}

test('com chaveiro, a chave é selada por ELE — e não pela amarra de máquina', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selo-'));
  const arquivo = path.join(dir, 'session.json');
  try {
    registrarSeloDoSistema(seloFalso());
    const r = new RememberedKey(arquivo, () => 'maquina-1');
    const chave = crypto.randomBytes(32);
    r.save(chave, 15);

    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { backend?: string };
    assert.equal(bruto.backend, 'sistema');
    assert.deepEqual(r.load(), chave);
  } finally {
    registrarSeloDoSistema(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selo de OUTRO dono não abre, e a lembrança é apagada', () => {
  // Acontece com um backup restaurado noutra conta: o arquivo veio junto e não
  // serve. Deixá-lo faria o mesmo tropeço em todo início.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selo-'));
  const arquivo = path.join(dir, 'session.json');
  try {
    registrarSeloDoSistema(seloFalso('ana'));
    new RememberedKey(arquivo, () => 'm').save(crypto.randomBytes(32), 15);

    registrarSeloDoSistema(seloFalso('bruno'));
    assert.equal(new RememberedKey(arquivo, () => 'm').load(), null);
    assert.equal(fs.existsSync(arquivo), false, 'a lembrança inútil é apagada');
  } finally {
    registrarSeloDoSistema(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lembrança do SISTEMA não é lida sem chaveiro — e não é erro', () => {
  // É o cofre sendo aberto no navegador, ou noutra sessão. Cai para a senha.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selo-'));
  const arquivo = path.join(dir, 'session.json');
  try {
    registrarSeloDoSistema(seloFalso());
    new RememberedKey(arquivo, () => 'm').save(crypto.randomBytes(32), 15);
    registrarSeloDoSistema(null);
    assert.equal(new RememberedKey(arquivo, () => 'm').load(), null);
  } finally {
    registrarSeloDoSistema(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('chaveiro indisponível cai para a amarra de máquina, sem perder a função', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selo-'));
  const arquivo = path.join(dir, 'session.json');
  try {
    registrarSeloDoSistema(seloFalso('ana', false));
    const r = new RememberedKey(arquivo, () => 'maquina-1');
    const chave = crypto.randomBytes(32);
    r.save(chave, 15);
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { backend?: string };
    assert.notEqual(bruto.backend, 'sistema');
    assert.deepEqual(r.load(), chave);
  } finally {
    registrarSeloDoSistema(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sem máquina E sem chaveiro, não há onde lembrar', () => {
  registrarSeloDoSistema(null);
  assert.equal(new RememberedKey('/tmp/nao-usado.json', () => '').available(), false);
  registrarSeloDoSistema(seloFalso());
  assert.equal(new RememberedKey('/tmp/nao-usado.json', () => '').available(), true);
  registrarSeloDoSistema(null);
});

test('no WINDOWS a lembrança em arquivo é recusada, mesmo com machine-id', async (t) => {
  // Recusar pela PLATAFORMA, e não confiar em `/etc/machine-id` falhar: sob Git
  // Bash ou com um disco Linux montado esse arquivo pode existir, e aí o
  // backend inseguro nasceria sem ninguém notar.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-win-'));
  const alvo = path.join(dir, 'session.json');
  const chaveiro = new RememberedKey(alvo, () => 'id-de-maquina-que-existe');

  const identidade = (chaveiro as unknown as {
    identidade(p: string): string | null;
  }).identidade.bind(chaveiro);

  assert.equal(identidade('win32'), null, 'no Windows, sem amarra de máquina');
  assert.ok(identidade('linux') !== null, 'no Linux continua funcionando');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
});

test('a recusa DIZ o motivo, em vez de não fazer nada', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-win-'));
  const chaveiro = new RememberedKey(path.join(dir, 'session.json'), () => {
    throw new Error('sem machine-id');
  });

  assert.match(chaveiro.porQueNao('win32') ?? '', /chaveiro do sistema/);
  assert.match(chaveiro.porQueNao('linux') ?? '', /identificador/);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
});
