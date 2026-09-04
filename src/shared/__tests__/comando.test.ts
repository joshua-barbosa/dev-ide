import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarComando, type ContextoDeComando } from '../terminal/comando';
import { CLI_MYSQL } from '../terminal/clientes/mysql';
import { CLI_POSTGRES } from '../terminal/clientes/postgres';

/** Senha reconhecível: se vazar em qualquer lugar, o teste acha. */
const SENHA = 'S3nh4-QUE-NAO-PODE-VAZAR';
const ARQUIVO = '/run/user/1000/dev-ide/abc123.cnf';
const SECRETOS = ['password'];

const TODOS = [
  ['mysql', CLI_MYSQL] as const,
  ['postgres', CLI_POSTGRES] as const,
];

function ctx(extra: Partial<ContextoDeComando> = {}): ContextoDeComando {
  return {
    fields: {
      host: 'acme-db-03.exemplo.invalido',
      port: 3306,
      user: 'usuario-acme',
      main_database: 'servidor-4',
      // Em produção a configuração resolvida CONTÉM a senha. O teste precisa
      // refletir isso, senão não exercita a proteção que importa.
      password: SENHA,
      ...(extra.fields ?? {}),
    },
    readOnly: false,
    arquivoDeCredencial: ARQUIVO,
    ...extra,
  };
}

// ---- a garantia que justifica esta spec (AC-9) ----

test('a senha NUNCA aparece nos argumentos, em nenhum driver', () => {
  for (const [nome, cli] of TODOS) {
    const cmd = montarComando(cli, ctx(), SENHA, SECRETOS);
    assert.ok(cmd !== null, `${nome} deveria montar comando`);

    for (const arg of cmd.args) {
      assert.ok(!arg.includes(SENHA), `senha em argv de ${nome}: ${arg}`);
    }
    // Nem em pedaço: `-p` seguido de senha colada também é vazamento.
    assert.ok(!cmd.args.join(' ').includes(SENHA), `senha na linha de ${nome}`);
  }
});

test('a senha NUNCA aparece no ambiente, em nenhum driver', () => {
  // `/proc/<pid>/environ` expõe o ambiente, e o próprio MySQL documenta
  // `MYSQL_PWD` como inseguro.
  for (const [nome, cli] of TODOS) {
    const cmd = montarComando(cli, ctx(), SENHA, SECRETOS);
    for (const [chave, valor] of Object.entries(cmd!.env)) {
      assert.ok(!valor.includes(SENHA), `senha em ${chave} de ${nome}`);
    }
  }
});

test('a senha vai no arquivo de credencial, que é para onde ela deve ir', () => {
  for (const [nome, cli] of TODOS) {
    const cmd = montarComando(cli, ctx(), SENHA, SECRETOS);
    assert.ok(cmd!.credencial !== null, `${nome} deveria produzir credencial`);
    assert.ok(cmd!.credencial.includes(SENHA), `${nome} não gravou a senha no arquivo`);
  }
});

test('os argumentos apontam para o arquivo, e não para o segredo', () => {
  const mysql = montarComando(CLI_MYSQL, ctx(), SENHA, SECRETOS)!;
  assert.ok(
    mysql.args.some((a) => a.includes(ARQUIVO)),
    'o mysql precisa receber o caminho do arquivo'
  );

  const pg = montarComando(CLI_POSTGRES, ctx(), SENHA, SECRETOS)!;
  assert.equal(pg.env.PGPASSFILE, ARQUIVO, 'o psql lê o arquivo por PGPASSFILE');
});

test('sem senha, nenhum arquivo de credencial é pedido', () => {
  for (const [nome, cli] of TODOS) {
    const cmd = montarComando(cli, { ...ctx(), arquivoDeCredencial: null }, '', SECRETOS);
    assert.equal(cmd!.credencial, null, `${nome} pediu arquivo sem precisar`);
  }
});

// ---- somente-leitura (AC-11) ----

test('conexão somente-leitura impõe a restrição também no cliente', () => {
  const mysql = montarComando(CLI_MYSQL, ctx({ readOnly: true }), SENHA, SECRETOS)!;
  const linha = mysql.args.join(' ');
  assert.match(linha, /init-command/, 'MySQL precisa de --init-command');
  assert.match(linha, /READ ONLY/i);

  const pg = montarComando(CLI_POSTGRES, ctx({ readOnly: true }), SENHA, SECRETOS)!;
  assert.match(pg.env.PGOPTIONS ?? '', /default_transaction_read_only=on/);
});

test('conexão de escrita não recebe restrição nenhuma', () => {
  const mysql = montarComando(CLI_MYSQL, ctx({ readOnly: false }), SENHA, SECRETOS)!;
  assert.ok(!mysql.args.join(' ').includes('READ ONLY'));

  const pg = montarComando(CLI_POSTGRES, ctx({ readOnly: false }), SENHA, SECRETOS)!;
  assert.equal(pg.env.PGOPTIONS, undefined);
});

// ---- driver sem cliente (AC-13) ----

test('driver que não declara cliente não produz comando', () => {
  // É o que faz a ação sumir para SQLite sem a interface saber o que é SQLite.
  assert.equal(montarComando(undefined, ctx(), SENHA, SECRETOS), null);
});

// ---- o comando em si ----

test('o MySQL recebe host, porta, usuário e banco', () => {
  const cmd = montarComando(CLI_MYSQL, ctx(), SENHA, SECRETOS)!;
  assert.equal(cmd.exec, 'mysql');
  const linha = cmd.args.join(' ');
  assert.match(linha, /acme-db-03/);
  assert.match(linha, /3306/);
  assert.match(linha, /usuario-acme/);
  assert.ok(cmd.args.includes('servidor-4'), 'o banco entra como último argumento');
});

test('o PostgreSQL recebe host, porta, usuário e banco', () => {
  // `main_database`, e não `database`. Este teste passava com o nome errado
  // porque INVENTAVA o campo — e assim escondia que driver nenhum o declara: o
  // `-d` nunca era montado em uso real, e o `psql` morria tentando abrir um
  // banco com o nome do usuário. Quem pega isso agora é
  // `campos-do-cliente.test.ts`, que monta os campos a partir do DRIVER.
  const cmd = montarComando(
    CLI_POSTGRES,
    ctx({
      fields: { host: '192.0.2.9', port: 5432, user: 'postgres', main_database: 'acme_registros' },
    }),
    SENHA,
    SECRETOS
  )!;
  assert.equal(cmd.exec, 'psql');
  const linha = cmd.args.join(' ');
  assert.match(linha, /192\.0\.2\.9/);
  assert.match(linha, /5432/);
  assert.match(linha, /postgres/);
  assert.match(linha, /acme_registros/);
});

test('campo ausente não vira argumento vazio', () => {
  // `mysql -h '' ...` falharia de um jeito confuso.
  const cmd = montarComando(CLI_MYSQL, ctx({ fields: { host: 'h', user: 'u' } }), SENHA, SECRETOS)!;
  assert.ok(!cmd.args.includes(''), 'nenhum argumento pode ser vazio');
});

test('o arquivo do MySQL sai no formato de option file', () => {
  const cmd = montarComando(CLI_MYSQL, ctx(), SENHA, SECRETOS)!;
  assert.match(cmd.credencial!, /^\[client\]/m);
  assert.match(cmd.credencial!, /^password=/m);
});

test('o arquivo do PostgreSQL sai no formato do .pgpass', () => {
  // host:porta:banco:usuário:senha — cinco campos separados por dois-pontos.
  const cmd = montarComando(CLI_POSTGRES, ctx(), SENHA, SECRETOS)!;
  const campos = cmd.credencial!.trim().split(':');
  assert.equal(campos.length, 5, `esperava 5 campos, veio: ${cmd.credencial}`);
  assert.equal(campos[4], SENHA);
});

// ---- a senha fora do alcance de quem monta (AC-9, defesa estrutural) ----

test('os campos secretos são removidos antes de o driver vê-los', () => {
  // Em produção a configuração resolvida CONTÉM a senha. Sem esta remoção, um
  // driver poderia escrever `texto(fields, 'password')` e pôr o segredo em
  // `argv` — o teste acima não pegaria, porque o vazamento seria legítimo do
  // ponto de vista do tipo.
  const espiao: string[] = [];
  const cliCurioso = {
    exec: 'curioso',
    campoDeSenha: 'password',
    montarArgs: ({ fields }: ContextoDeComando) => {
      espiao.push(...Object.keys(fields));
      return Object.values(fields).map(String);
    },
    montarCredencial: (s: string) => s,
  };

  const comSenhaNosCampos = {
    ...ctx(),
    fields: { ...ctx().fields, password: SENHA },
  };
  const cmd = montarComando(cliCurioso, comSenhaNosCampos, SENHA, ['password'])!;

  assert.equal(espiao.includes('password'), false, 'o driver enxergou o campo secreto');
  assert.ok(!cmd.args.join(' ').includes(SENHA), 'a senha chegou em argv');
});

test('a remoção não leva junto campo que apenas parece secreto', () => {
  const cmd = montarComando(
    CLI_MYSQL,
    { ...ctx(), fields: { host: 'h', user: 'u', main_database: 'passwords' } },
    SENHA,
    ['password']
  )!;
  assert.ok(cmd.args.includes('passwords'), 'banco chamado "passwords" foi removido por engano');
});
