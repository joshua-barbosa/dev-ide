// SQL de usuário e permissão: gerado, nunca executado (P3).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alvoEmSql, apagarUsuario, aspas, conceder, crase, criarUsuario, listaDePrivilegios,
  nomeDoUsuario, revogar, SENHA_RESERVADA, texto,
} from '../sql/usuarios';

// ---------------------------------------------------------------------------
// Escapar — é aqui que se erra, e o erro é executável
// ---------------------------------------------------------------------------

test('aspas dobram a aspa dupla', () => {
  assert.equal(aspas('ana'), '"ana"');
  assert.equal(aspas('a"b'), '"a""b"');
});

test('texto dobra a aspa simples', () => {
  assert.equal(texto("d'agua"), "'d''agua'");
});

test('crase dobra a crase', () => {
  assert.equal(crase('banco'), '`banco`');
  assert.equal(crase('a`b'), '`a``b`');
});

test('nome hostil não escapa do literal — nem no DROP', () => {
  // O texto é gerado, e não executado. Mas é gerado PARA ser executado: se ele
  // colar isto num .sql, o que estiver mal escapado roda.
  const sql = apagarUsuario('postgres', { nome: 'a"; DROP ROLE b; --' });
  assert.match(sql, /DROP ROLE "a""; DROP ROLE b; --";/);
  // Uma linha de comando só: o `;` do nome não abriu outra.
  assert.equal(sql.split('\n').filter((l) => !l.startsWith('--')).length, 1);
});

// ---------------------------------------------------------------------------
// O par nome@host do MySQL
// ---------------------------------------------------------------------------

test('no MySQL a identidade é o PAR, e o host padrão é %', () => {
  assert.equal(nomeDoUsuario('mysql', { nome: 'ana' }), "'ana'@'%'");
  assert.equal(nomeDoUsuario('mysql', { nome: 'ana', host: 'localhost' }), "'ana'@'localhost'");
});

test('no Postgres não há host: quem decide de onde se conecta é o pg_hba', () => {
  assert.equal(nomeDoUsuario('postgres', { nome: 'ana', host: 'localhost' }), '"ana"');
});

test('o DROP do MySQL avisa que apaga SÓ aquele host', () => {
  // É o erro clássico: apagar 'ana'@'%' achando que apagou 'ana'@'localhost'.
  assert.match(apagarUsuario('mysql', { nome: 'ana' }), /outro\n-- host continuam existindo/);
});

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

test('criar usuário NUNCA traz senha de verdade, e diz para trocar', () => {
  for (const d of ['mysql', 'postgres'] as const) {
    const sql = criarUsuario(d, { nome: 'ana' });
    assert.match(sql, new RegExp(SENHA_RESERVADA));
    assert.match(sql, /^-- Troque /, 'o aviso vem antes do comando');
  }
});

// ---------------------------------------------------------------------------
// Alvo
// ---------------------------------------------------------------------------

test('o mesmo alvo escrito de duas formas que não se parecem', () => {
  const alvo = { tipo: 'schema', schema: 'loja' } as const;
  assert.equal(alvoEmSql('mysql', alvo), '`loja`.*');
  assert.equal(alvoEmSql('postgres', alvo), 'ALL TABLES IN SCHEMA "loja"');
});

test('banco e schema são a MESMA coisa no MySQL', () => {
  assert.equal(alvoEmSql('mysql', { tipo: 'banco', banco: 'loja' }), '`loja`.*');
  assert.equal(alvoEmSql('postgres', { tipo: 'banco', banco: 'loja' }), 'DATABASE "loja"');
});

test('tabela com e sem schema', () => {
  assert.equal(alvoEmSql('mysql', { tipo: 'tabela', tabela: 't' }), '`t`');
  assert.equal(alvoEmSql('mysql', { tipo: 'tabela', schema: 'loja', tabela: 't' }), '`loja`.`t`');
  assert.equal(alvoEmSql('postgres', { tipo: 'tabela', schema: 'p', tabela: 't' }), 'TABLE "p"."t"');
});

// ---------------------------------------------------------------------------
// Privilégios
// ---------------------------------------------------------------------------

test('ALL PRIVILEGES ENGOLE os outros', () => {
  // Escrever `SELECT, ALL PRIVILEGES` faria a linha mentir sobre o que concede.
  assert.equal(listaDePrivilegios(['SELECT', 'ALL PRIVILEGES']), 'ALL PRIVILEGES');
});

test('repetido entra uma vez só, e minúscula vira maiúscula', () => {
  assert.equal(listaDePrivilegios(['select', 'SELECT', 'insert']), 'SELECT, INSERT');
});

test('lista vazia vira SELECT — o menos poderoso, e não o mais', () => {
  assert.equal(listaDePrivilegios([]), 'SELECT');
  assert.equal(listaDePrivilegios(['  ']), 'SELECT');
});

// ---------------------------------------------------------------------------
// GRANT e REVOKE
// ---------------------------------------------------------------------------

test('o GRANT do MySQL vem com FLUSH PRIVILEGES', () => {
  // Sem ele o GRANT só vale na próxima conexão, e a pessoa jura que não funcionou.
  const sql = conceder('mysql', {
    usuario: { nome: 'ana' }, privilegios: ['SELECT'],
    alvo: { tipo: 'banco', banco: 'loja' },
  });
  assert.equal(sql, "GRANT SELECT ON `loja`.* TO 'ana'@'%';\nFLUSH PRIVILEGES;");
});

test('o GRANT do Postgres NÃO leva FLUSH — lá isso não existe', () => {
  const sql = conceder('postgres', {
    usuario: { nome: 'ana' }, privilegios: ['CONNECT'],
    alvo: { tipo: 'banco', banco: 'loja' },
  });
  assert.equal(sql, 'GRANT CONNECT ON DATABASE "loja" TO "ana";');
});

test('"tudo" no Postgres avisa que é só o schema public', () => {
  const sql = conceder('postgres', {
    usuario: { nome: 'ana' }, privilegios: ['SELECT'], alvo: { tipo: 'tudo' },
  });
  assert.match(sql, /^-- O Postgres não tem "tudo" numa linha/);
  assert.match(sql, /GRANT SELECT ON ALL TABLES IN SCHEMA public TO "ana";/);
});

test('revogar é o espelho de conceder', () => {
  const pedido = {
    usuario: { nome: 'ana', host: '10.0.0.%' }, privilegios: ['INSERT', 'UPDATE'],
    alvo: { tipo: 'tabela', schema: 'loja', tabela: 'pedidos' },
  } as const;
  assert.equal(
    revogar('mysql', pedido),
    "REVOKE INSERT, UPDATE ON `loja`.`pedidos` FROM 'ana'@'10.0.0.%';\nFLUSH PRIVILEGES;"
  );
});

test('nenhuma função deste módulo executa nada — só devolve texto', () => {
  // A regra do P3, virada teste: tudo o que sai daqui é string.
  const saidas = [
    criarUsuario('mysql', { nome: 'a' }),
    apagarUsuario('postgres', { nome: 'a' }),
    conceder('mysql', { usuario: { nome: 'a' }, privilegios: [], alvo: { tipo: 'tudo' } }),
    revogar('postgres', { usuario: { nome: 'a' }, privilegios: [], alvo: { tipo: 'tudo' } }),
  ];
  for (const s of saidas) assert.equal(typeof s, 'string');
});
