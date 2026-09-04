// O cliente de linha de comando só pode ler campos que o driver DECLARA.
//
// Este teste nasce de um defeito real: o `psql` lia `database`, e o driver do
// Postgres declara `main_database`. O `-d` nunca era montado, o cliente tentava
// abrir um banco com o nome do usuário e morria com código 2 — e do lado do
// editor isso chegava como "The terminal process failed to launch".
//
// Nada disso aparecia numa suíte que monta o comando com um objeto de campos
// escrito à mão: bastava o teste inventar `database` para o defeito sumir. A
// única defesa é comparar o que o cliente USA com o que o driver DIZ ter — e é
// para isso que `campoDeSenha` e `campoDeBanco` são declarados.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriverRegistry } from '../connections/registry';
import { registerBuiltinDrivers } from '../connections/drivers';

const registry = registerBuiltinDrivers(new DriverRegistry());

/** Os drivers que têm cliente de linha de comando. */
function comCli(): { tipo: string; campos: Set<string>; cli: NonNullable<ReturnType<typeof pegar>> }[] {
  const lista = [];
  for (const info of registry.list()) {
    const driver = registry.get(info.type);
    if (driver.cli === undefined) continue;
    lista.push({
      tipo: info.type,
      campos: new Set(driver.fields.map((f) => f.name)),
      cli: driver.cli,
    });
  }
  return lista;
}
const pegar = (tipo: string) => registry.get(tipo).cli;

test('há drivers com cliente de linha de comando para testar', () => {
  assert.ok(comCli().length >= 3, 'esperava ao menos mysql, postgres e redis');
});

test('o campo de SENHA que o cliente lê existe no driver', () => {
  for (const { tipo, campos, cli } of comCli()) {
    if (cli.campoDeSenha === undefined) continue;
    assert.ok(
      campos.has(cli.campoDeSenha),
      `${tipo}: o cliente lê "${cli.campoDeSenha}", que o driver não declara`
    );
  }
});

test('o campo de BANCO que o cliente lê existe no driver', () => {
  for (const { tipo, campos, cli } of comCli()) {
    if (cli.campoDeBanco === undefined) continue;
    assert.ok(
      campos.has(cli.campoDeBanco),
      `${tipo}: o cliente lê "${cli.campoDeBanco}", que o driver não declara`
    );
  }
});

test('campo de banco VAZIO não vira conexão sem banco onde há padrão', () => {
  // O `psql` sem `-d` abre o banco com o NOME DO USUÁRIO, e o servidor
  // responde `FATAL: database "<usuário>" does not exist` — que parece
  // permissão ou rede, e é uma opção que faltou. Ele viu essa mensagem.
  const pg = registry.get('postgres').cli;
  assert.ok(pg !== undefined);
  const args = pg.montarArgs({
    fields: { host: 'h', port: '5432', user: 'alguem', main_database: '' },
    readOnly: false,
    arquivoDeCredencial: null,
  });
  assert.ok(args.includes('-d'), `esperava -d em ${JSON.stringify(args)}`);
  assert.ok(args.includes('postgres'), `esperava o banco de manutenção em ${JSON.stringify(args)}`);
});

test('o banco escolhido CHEGA na linha de comando', () => {
  for (const { tipo, campos, cli } of comCli()) {
    if (cli.campoDeBanco === undefined) continue;
    // Campos preenchidos a partir do que o DRIVER declara — nunca de uma lista
    // escrita à mão, que foi justamente o que escondeu o defeito.
    const fields: Record<string, string> = {};
    for (const nome of campos) fields[nome] = `valor-de-${nome}`;
    const args = cli.montarArgs({ fields, readOnly: false, arquivoDeCredencial: null });
    assert.ok(
      args.includes(`valor-de-${cli.campoDeBanco}`),
      `${tipo}: o banco não chegou aos argumentos — ${JSON.stringify(args)}`
    );
  }
});
