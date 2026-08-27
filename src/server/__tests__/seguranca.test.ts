// O `Security` da árvore (N003).
//
// O que se testa aqui é a parte que decide SUMIR: um erro de permissão vira
// ausência do nó, e qualquer outro erro continua sendo erro. Errar para o lado
// errado esconde um servidor fora do ar sob "você não tem permissão".
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categoriasDeSeguranca,
  ehPermissaoNegada,
  podeCriarNoMysql,
  podeCriarNoPostgres,
} from '../connections/drivers/seguranca';

test('permissão negada do MySQL é reconhecida pelo errno', () => {
  // O caso dele, de 26/08: SELECT command denied ... for table 'user'.
  assert.equal(ehPermissaoNegada({ errno: 1142, message: "SELECT command denied" }), true);
  assert.equal(ehPermissaoNegada({ errno: 1143 }), true);
  assert.equal(ehPermissaoNegada({ errno: 1044 }), true);
  assert.equal(ehPermissaoNegada({ errno: 1045 }), true);
  assert.equal(ehPermissaoNegada({ code: 'ER_TABLEACCESS_DENIED_ERROR' }), true);
});

test('permissão negada do PostgreSQL é o SQLSTATE 42501', () => {
  assert.equal(ehPermissaoNegada({ code: '42501' }), true);
  assert.equal(ehPermissaoNegada({ code: '42P01' }), false);
});

test('o que NÃO é permissão continua sendo erro', () => {
  assert.equal(ehPermissaoNegada({ code: 'ECONNREFUSED' }), false);
  assert.equal(ehPermissaoNegada({ errno: 2013, message: 'Lost connection' }), false);
  assert.equal(ehPermissaoNegada(new Error('qualquer coisa')), false);
  assert.equal(ehPermissaoNegada(undefined), false);
  assert.equal(ehPermissaoNegada(null), false);
});

test('a mensagem sozinha não basta para esconder o nó', () => {
  // "denied" no texto de um erro de rede não pode virar ausência silenciosa.
  assert.equal(ehPermissaoNegada({ message: 'connection denied by proxy' }), false);
});

test('no PostgreSQL cria quem é superusuário OU tem CREATEROLE', () => {
  // Os dois servidores dele: ia_master é superusuário sem CREATEROLE;
  // usr_portal_publico não é nenhum dos dois.
  assert.equal(podeCriarNoPostgres({ rolsuper: true, rolcreaterole: false }), true);
  assert.equal(podeCriarNoPostgres({ rolsuper: false, rolcreaterole: true }), true);
  assert.equal(podeCriarNoPostgres({ rolsuper: false, rolcreaterole: false }), false);
  assert.equal(podeCriarNoPostgres(undefined), false);
});

test('no MySQL cria quem tem CREATE USER ou ALL PRIVILEGES em *.*', () => {
  assert.equal(podeCriarNoMysql(["GRANT CREATE USER ON *.* TO 'r'@'%'"]), true);
  assert.equal(podeCriarNoMysql(["GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost'"]), true);
  assert.equal(podeCriarNoMysql(["GRANT SELECT, INSERT ON `escola`.* TO 'r'@'%'"]), false);
  // ALL PRIVILEGES num banco só NÃO cria usuário — é o engano mais fácil aqui.
  assert.equal(podeCriarNoMysql(["GRANT ALL PRIVILEGES ON `escola`.* TO 'r'@'%'"]), false);
  assert.equal(podeCriarNoMysql([]), false);
});

test('o PostgreSQL tem Users e Roles; o MySQL, só Users', () => {
  assert.deepEqual(
    categoriasDeSeguranca('postgres').map((c) => c.id),
    ['users', 'roles']
  );
  assert.deepEqual(
    categoriasDeSeguranca('mysql').map((c) => c.id),
    ['users']
  );
});
