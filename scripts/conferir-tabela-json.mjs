// {{lista}} como TABELA (spec 114, D) contra MySQL 8, PostgreSQL 16 e SQL
// Server 2022 DE VERDADE, em contêineres descartáveis — nada dos servidores
// dele. O pedido: "select * from messages, onde messages é array de objects".
//
// Usa os DRIVERS do motor (dist/), e não um cliente à parte: o que se prova é
// o caminho inteiro — o SQL que o motor gera, os parâmetros e o driver.
//
//   npm run build:server && npm run conferir:tabela-json
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const dist = (p) => import(path.join(RAIZ, 'dist', p));
const { montarSqlComParametros } = await dist('shared/notebook/parametros.js');
const { mysqlDriver } = await dist('server/connections/drivers/mysql.js');
const { postgresDriver } = await dist('server/connections/drivers/postgres.js');
const { sqlserverDriver } = await dist('server/connections/drivers/sqlserver.js');

const SUFIXO = String(process.pid);
const SENHA = 'senha-de-teste';
const SENHA_MS = 'Senha-de-teste-1234';
const BANCOS = [
  { nome: 'MySQL', dialeto: 'mysql', estilo: 'interrogacao', driver: mysqlDriver, contêiner: `braytech-tj-my-${SUFIXO}`, porta: 3398,
    docker: ['-e', `MYSQL_ROOT_PASSWORD=${SENHA}`, '-e', 'MYSQL_DATABASE=exemplo', 'mysql:8'], interna: 3306,
    campos: { user: 'root', password: SENHA, main_database: 'exemplo' }, database: 'exemplo' },
  { nome: 'PostgreSQL', dialeto: 'postgres', estilo: 'dolar', driver: postgresDriver, contêiner: `braytech-tj-pg-${SUFIXO}`, porta: 5498,
    docker: ['-e', `POSTGRES_PASSWORD=${SENHA}`, '-e', 'POSTGRES_DB=exemplo', 'postgres:16'], interna: 5432,
    campos: { user: 'postgres', password: SENHA, main_database: 'exemplo' }, database: 'exemplo' },
  { nome: 'SQL Server', dialeto: 'sqlserver', estilo: 'arroba', driver: sqlserverDriver, contêiner: `braytech-tj-ms-${SUFIXO}`, porta: 1498,
    docker: ['-e', 'ACCEPT_EULA=Y', '-e', `MSSQL_SA_PASSWORD=${SENHA_MS}`, 'mcr.microsoft.com/mssql/server:2022-latest'], interna: 1433,
    campos: { user: 'sa', password: SENHA_MS, main_database: 'master' }, database: 'master' },
];

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);
const docker = (...args) => execFileSync('docker', args, { stdio: 'pipe' }).toString();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// O array dele, com o que costuma vir junto: acento e espaço no nome,
// booleano, decimal, nulo e um objeto dentro.
const messages = [
  { id: 1, message: 'olá', lido: true, nota: 9.5, 'nota final': 10, extra: { origem: 'app' } },
  { id: 2, message: null, lido: false, nota: 7, 'nota final': null, extra: null },
];

async function sessaoDe(b) {
  for (let i = 0; i < 120; i++) {
    try {
      const s = await b.driver.connect({
        id: b.dialeto, type: b.dialeto, label: b.nome, readOnly: false,
        fields: { host: '127.0.0.1', port: b.porta, ...b.campos },
      });
      await s.execute({ statement: 'SELECT 1', database: b.database });
      return s;
    } catch {
      await esperar(1000);
    }
  }
  throw new Error(`o ${b.nome} não subiu`);
}

const rodar = (s, b, texto) => {
  const { sql, params } = montarSqlComParametros(texto, { messages }, b.estilo, b.dialeto);
  return s.execute({ statement: sql, params, database: b.database, semTeto: true });
};
const texto = (v) => (v === null || v === undefined ? null : String(v));

try {
  for (const b of BANCOS) docker('run', '-d', '--name', b.contêiner, '-p', `${b.porta}:${b.interna}`, ...b.docker);
  for (const b of BANCOS) {
    let s;
    try {
      s = await sessaoDe(b);
      await s.execute({ statement: 'CREATE TABLE users (id INT, email VARCHAR(100))', database: b.database });
      await s.execute({ statement: "INSERT INTO users VALUES (1, 'ana@exemplo.test'), (2, 'bia@exemplo.test')", database: b.database });

      // O pedido, com join numa tabela do banco.
      const j = await rodar(s, b, 'SELECT m.id, m.message, u.email FROM {{messages}} m JOIN users u ON u.id = m.id ORDER BY m.id');
      marcar(`${b.nome}: {{messages}} m com JOIN numa tabela do banco`,
        JSON.stringify(j.rows.map((r) => [Number(r[0]), texto(r[1]), texto(r[2])])) ===
          JSON.stringify([[1, 'olá', 'ana@exemplo.test'], [2, null, 'bia@exemplo.test']]),
        JSON.stringify(j.rows));

      // Sem apelido: o motor põe o nome da variável.
      const sem = await rodar(s, b, 'SELECT messages.id FROM {{messages}} ORDER BY messages.id');
      marcar(`${b.nome}: sem apelido, o nome da variável vale`, sem.rows.length === 2, JSON.stringify(sem.rows));

      // Tipos: booleano, decimal, nome com espaço e acento, objeto dentro.
      const t = await rodar(s, b, 'SELECT m.lido, m.nota, m.* FROM {{messages}} AS m ORDER BY m.id');
      const colunas = t.columns.map((c) => c.name);
      const primeira = t.rows[0];
      const lido = primeira[0];
      marcar(`${b.nome}: booleano, decimal e "nota final" (espaço no nome) chegam`,
        (lido === true || lido === 1 || lido === '1' || lido === 't') && Number(primeira[1]) === 9.5 &&
          colunas.includes('nota final'),
        JSON.stringify({ colunas, primeira }));
      const extra = primeira[colunas.lastIndexOf('extra')];
      marcar(`${b.nome}: objeto dentro do item vem como JSON`,
        /origem/.test(typeof extra === 'string' ? extra : JSON.stringify(extra)), JSON.stringify(extra));
    } catch (e) {
      marcar(`${b.nome}: rodou até o fim`, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
    } finally {
      await s?.close?.().catch?.(() => undefined);
    }
  }
} finally {
  for (const b of BANCOS) {
    try { docker('rm', '-f', b.contêiner); } catch { /* já não existe */ }
  }
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
