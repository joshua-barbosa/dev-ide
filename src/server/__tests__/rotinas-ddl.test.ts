// `Ver DDL`, `Atualizar` e `Apagar` de procedure, function, trigger e event.
//
// Ele, em 08/09/2026: *"As functions, procedures não consigo abrir para ver o
// que está na estrutura E também não tenho a opção de atualizar a procedures ou
// functions"*, e depois *"Ou eventos"*.
//
// Não era defeito da extensão: no MOTOR, uma rotina não recebia ação nenhuma —
// nem `Ver DDL`. A IDE tinha o mesmo buraco, e ninguém o tinha notado porque a
// lista de rotinas abria e parecia completa.
//
// O SQL de cada banco é conferido aqui, sem servidor: o que quebra na tela dele
// é o comando errado para o objeto, e isso dá para provar por texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NodeAction } from '../connections/types';
import {
  ACOES_DE_ROTINA,
  comandoDeDdlDeRotina,
  comandoDeDropDeRotina,
  esqueletoDeAtualizacao,
  type AlvoDeRotina,
} from '../connections/drivers/rotinas';

const my = (categoria: string, objeto: string): AlvoDeRotina => ({
  categoria, schema: 'app', objeto,
  citado: `\`app\`.\`${objeto}\``, nomeCitado: `\`${objeto}\``,
});
const pg = (categoria: string, objeto: string): AlvoDeRotina => ({
  categoria, schema: 'app', objeto,
  citado: `"app"."${objeto}"`, nomeCitado: `"${objeto}"`,
});

test('procedure e function ganham Ver DDL e Atualizar', () => {
  const ids = ACOES_DE_ROTINA.map((a: NodeAction) => a.id);
  assert.deepEqual(ids, ['ddl-rotina', 'atualizar-rotina', 'drop-rotina']);
});

test('a ação de apagar é marcada como perigosa, e as outras não', () => {
  const perigosas = ACOES_DE_ROTINA.filter((a: NodeAction) => a.danger === true)
    .map((a: NodeAction) => a.id);
  assert.deepEqual(perigosas, ['drop-rotina']);
});

test('MySQL usa SHOW CREATE do TIPO certo — não SHOW CREATE TABLE', () => {
  // `SHOW CREATE TABLE minha_procedure` é o erro que ele viu: o comando existe,
  // o objeto existe, e o servidor recusa porque não são a mesma coisa.
  assert.equal(
    comandoDeDdlDeRotina('mysql', my('procedures', 'fecha_mes')),
    'SHOW CREATE PROCEDURE `app`.`fecha_mes`'
  );
  assert.equal(
    comandoDeDdlDeRotina('mysql', my('functions', 'idade')),
    'SHOW CREATE FUNCTION `app`.`idade`'
  );
  assert.equal(
    comandoDeDdlDeRotina('mysql', my('triggers', 'ao_gravar')),
    'SHOW CREATE TRIGGER `app`.`ao_gravar`'
  );
  assert.equal(
    comandoDeDdlDeRotina('mysql', my('events', 'diario')),
    'SHOW CREATE EVENT `app`.`diario`'
  );
});

test('PostgreSQL usa pg_get_functiondef, que já devolve o CREATE OR REPLACE', () => {
  const sql = comandoDeDdlDeRotina('postgres', pg('functions', 'idade'));
  assert.notEqual(sql, null);
  assert.match(String(sql), /pg_get_functiondef/);
  assert.match(String(sql), /'app\.idade'::regproc/);
});

test('gatilho do PostgreSQL não passa por pg_get_functiondef', () => {
  // `pg_get_functiondef` num gatilho lê a FUNÇÃO de dentro, não o
  // `CREATE TRIGGER` — devolveria outro objeto sem dizer que trocou.
  const sql = comandoDeDdlDeRotina('postgres', {
    ...pg('triggers', 'ao_gravar'), tabela: 'alunos', tabelaCitada: '"app"."alunos"',
  });
  assert.match(String(sql), /pg_get_triggerdef/);
  assert.match(String(sql), /t\.tgname = 'ao_gravar'/);
  assert.match(String(sql), /c\.relname = 'alunos'/);
});

test('o PostgreSQL não tem EVENT, e o motor não finge que tem', () => {
  assert.equal(comandoDeDdlDeRotina('postgres', pg('events', 'diario')), null);
  assert.equal(comandoDeDropDeRotina('postgres', pg('events', 'diario')), null);
});

test('aspa simples no nome não escapa para dentro do literal', () => {
  const sql = String(comandoDeDdlDeRotina('postgres', pg('functions', "o'brien")));
  assert.match(sql, /'app\.o''brien'::regproc/);
});

test('categoria que não é rotina não tem comando — quem chamar erra alto', () => {
  assert.equal(comandoDeDdlDeRotina('mysql', my('tables', 'alunos')), null);
  assert.equal(comandoDeDropDeRotina('mysql', my('tables', 'alunos')), null);
});

test('o esqueleto de atualização do MySQL DROPa e recria — não existe REPLACE', () => {
  const sql = esqueletoDeAtualizacao(
    'mysql', my('procedures', 'fecha_mes'),
    'CREATE PROCEDURE `fecha_mes`() BEGIN SELECT 1; END'
  );
  assert.match(sql, /DROP PROCEDURE IF EXISTS `app`\.`fecha_mes`/);
  // **Nada roda por clique** (spec 040): o aviso vai DENTRO do SQL gerado.
  assert.match(sql, /ainda NÃO rodou/i);
});

test('o CREATE do MySQL vem sem esquema, e o esqueleto põe o esquema de volta', () => {
  // Sem isto: DROP no esquema certo, CREATE no banco que estiver ativo no
  // editor. A rotina muda de lugar sem ninguém pedir.
  const sql = esqueletoDeAtualizacao(
    'mysql', my('procedures', 'fecha_mes'),
    "CREATE DEFINER=`dono`@`%` PROCEDURE `fecha_mes`() BEGIN SELECT 1; END"
  );
  assert.match(sql, /PROCEDURE `app`\.`fecha_mes`\(\)/);
  assert.equal(/PROCEDURE `fecha_mes`\(/.test(sql), false);
});

test('o esqueleto do MySQL não traz DELIMITER, que o servidor recusa', () => {
  const sql = esqueletoDeAtualizacao(
    'mysql', my('procedures', 'p'), 'CREATE PROCEDURE `p`() BEGIN SELECT 1; END'
  );
  assert.equal(/^[ \t]*DELIMITER\b/im.test(sql), false);
});

test('corpo com $$ não some ao qualificar o nome', () => {
  // `String.replace` com string de troca interpreta `$&` e `$$`; a função de
  // troca não. O corpo de uma function pode ter os dois.
  const corpo = 'CREATE FUNCTION `f`() RETURNS text RETURN CONCAT($$, "$&")';
  const sql = esqueletoDeAtualizacao('mysql', my('functions', 'f'), corpo);
  assert.match(sql, /CONCAT\(\$\$, "\$&"\)/);
});

test('o esqueleto do PostgreSQL usa CREATE OR REPLACE, sem DROP', () => {
  const corpo = 'CREATE OR REPLACE FUNCTION app.idade() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql';
  const sql = esqueletoDeAtualizacao('postgres', pg('functions', 'idade'), corpo);
  assert.match(sql, /CREATE OR REPLACE FUNCTION/);
  assert.equal(/DROP FUNCTION/.test(sql), false);
  assert.match(sql, /ainda NÃO rodou/i);
});

test('gatilho do PostgreSQL é DROP + CREATE, e o DROP pede a tabela', () => {
  const alvo = {
    ...pg('triggers', 'ao_gravar'), tabela: 'alunos', tabelaCitada: '"app"."alunos"',
  };
  const sql = esqueletoDeAtualizacao('postgres', alvo, 'CREATE TRIGGER ao_gravar BEFORE INSERT ON app.alunos FOR EACH ROW EXECUTE FUNCTION app.f()');
  assert.match(sql, /DROP TRIGGER IF EXISTS "ao_gravar" ON "app"\."alunos"/);
  assert.match(sql, /CREATE TRIGGER ao_gravar/);
});

test('o esqueleto sem corpo lido não inventa um CREATE vazio', () => {
  // Devolver `CREATE PROCEDURE x() BEGIN END` seria oferecer a ele APAGAR o
  // corpo da rotina achando que a está atualizando.
  assert.throws(() => esqueletoDeAtualizacao('mysql', my('procedures', 'b'), ''));
});
