// Data e hora mostradas COMO ESTÃO GRAVADAS — e gravadas de volta sem mudar.
//
// Ele (25/09): *"Está adicionando mais 3 horas nas colunas timestamp ou
// datetime aonde está gravado 2026-09-25T11:19:41.208Z está mostrando
// 2026-09-25T14:19:41.208Z"*.
//
// O motivo: `DATETIME` não tem fuso. O driver lia o valor como hora LOCAL
// (−03:00), montava um `Date`, e a célula virava `toISOString()` — UTC, três
// horas a mais, com um `Z` que afirma um fuso que o banco nunca guardou.
//
// Precisa de bancos de verdade, porque o defeito mora no driver de rede e não
// no nosso código puro: sobe MySQL 8, PostgreSQL 16 e SQL Server 2022 em
// Docker, descartáveis, e
// roda o motor com o fuso de São Paulo FORÇADO — senão numa máquina em UTC a
// guarda passaria verde por cima do defeito.
//
//   npm run conferir:datas        (exige Docker; leva ~1 min)
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import pg from 'pg';

const RAIZ = path.resolve(import.meta.dirname, '..');
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const SUFIXO = String(process.pid);
const MY = { nome: `braytech-datas-mysql-${SUFIXO}`, porta: 3397 };
const PG = { nome: `braytech-datas-pg-${SUFIXO}`, porta: 5497 };
const MS = { nome: `braytech-datas-mssql-${SUFIXO}`, porta: 1497, senha: 'Senha-de-teste-1234' };
const PORTA_MOTOR = 4497;
const SENHA = 'senha-de-teste';
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-datas-'));

/** O valor que ele viu, sem fuso — exatamente como o banco guarda. */
const GRAVADO = '2026-09-25 11:19:41.208';
const DIA = '2026-09-25';

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);

const docker = (...args) => execFileSync('docker', args, { stdio: 'pipe' }).toString();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(teste, tentativas = 90) {
  for (let i = 0; i < tentativas; i++) {
    try { if (await teste()) return true; } catch { /* ainda subindo */ }
    await esperar(1000);
  }
  return false;
}

let motor;
try {
  docker('run', '-d', '--name', MY.nome, '-e', `MYSQL_ROOT_PASSWORD=${SENHA}`,
    '-e', 'MYSQL_DATABASE=exemplo', '-p', `${MY.porta}:3306`, 'mysql:8');
  docker('run', '-d', '--name', PG.nome, '-e', `POSTGRES_PASSWORD=${SENHA}`,
    '-e', 'POSTGRES_DB=exemplo', '-p', `${PG.porta}:5432`, 'postgres:16');
  docker('run', '-d', '--name', MS.nome, '-e', 'ACCEPT_EULA=Y', '-e', `MSSQL_SA_PASSWORD=${MS.senha}`,
    '-p', `${MS.porta}:1433`, 'mcr.microsoft.com/mssql/server:2022-latest');

  const conectarMy = () => mysql.createConnection({
    host: '127.0.0.1', port: MY.porta, user: 'root', password: SENHA, database: 'exemplo',
  });
  if (!(await ate(async () => { await (await conectarMy()).end(); return true; }))) {
    throw new Error('o MySQL não subiu');
  }
  const my = await conectarMy();
  await my.query(`CREATE TABLE eventos (
    id INT PRIMARY KEY, quando DATETIME(3), marcado TIMESTAMP(3) NULL, dia DATE, nota VARCHAR(20))`);
  // Sessão em UTC ao gravar: é o que torna o TIMESTAMP comparável ao literal.
  await my.query("SET time_zone = '+00:00'");
  await my.query('INSERT INTO eventos VALUES (1, ?, ?, ?, ?)', [GRAVADO, GRAVADO, DIA, 'antes']);
  await my.end();

  const clientePg = () => new pg.Client({
    host: '127.0.0.1', port: PG.porta, user: 'postgres', password: SENHA, database: 'exemplo',
  });
  if (!(await ate(async () => { const c = clientePg(); await c.connect(); await c.end(); return true; }))) {
    throw new Error('o PostgreSQL não subiu');
  }
  const cpg = clientePg();
  await cpg.connect();
  await cpg.query(`CREATE TABLE eventos (
    id INT PRIMARY KEY, quando TIMESTAMP(3), marcado TIMESTAMPTZ(3), dia DATE, nota TEXT)`);
  await cpg.query("INSERT INTO eventos VALUES (1, $1, $2, $3, 'antes')", [GRAVADO, `${GRAVADO}+00`, DIA]);
  await cpg.end();

  motor = spawn(process.execPath, [MOTOR], {
    stdio: 'ignore',
    env: {
      ...process.env,
      // O fuso DELE. Sem forçar, numa máquina em UTC isto passaria verde.
      TZ: 'America/Sao_Paulo',
      PORT: String(PORTA_MOTOR),
      DEV_IDE_HOME: path.join(casa, 'casa'),
      DEV_IDE_VAULT: path.join(casa, 'vault.json'),
      DEV_IDE_SESSION: path.join(casa, 'sessao.json'),
    },
  });
  const api = async (rota, corpo) => {
    const r = await fetch(`http://127.0.0.1:${PORTA_MOTOR}${rota}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      ...(corpo === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
    }).then((x) => x.json());
    if (r.success !== true) throw new Error(r.error ?? 'erro sem mensagem');
    return r.data;
  };
  if (!(await ate(() => api('/api/connections/drivers').then(() => true), 30))) {
    throw new Error('o motor não subiu');
  }
  await api('/api/connections/vault', {});

  // O SQL Server é preparado PELO MOTOR: o driver de teste seria outro
  // `tedious` com outra configuração, e o que se quer provar é a nossa.
  const ms = await api('/api/connections', {
    type: 'sqlserver', label: 'SQL Server de exemplo', group: 'Exemplos', readOnly: false,
    fields: { host: '127.0.0.1', port: MS.porta, user: 'sa', password: MS.senha, main_database: 'master' },
  });
  const noMs = (statement) => api(`/api/connections/${ms.id}/execute`, { statement, database: 'master' });
  if (!(await ate(() => noMs('SELECT 1').then(() => true), 120))) throw new Error('o SQL Server não subiu');
  await noMs(`CREATE TABLE eventos (id INT PRIMARY KEY, quando DATETIME, fino DATETIME2(7),
    curto SMALLDATETIME, dia DATE, hora TIME(7), comfuso DATETIMEOFFSET(3))`);
  await noMs(`INSERT INTO eventos VALUES (1, '${GRAVADO}', '2026-09-25 11:19:41.2084567',
    '2026-09-25 11:19:00', '${DIA}', '11:19:41.2084567', '${GRAVADO} -03:00')`);

  const cenarios = [
    {
      nome: 'MySQL', type: 'mysql', porta: MY.porta, user: 'root', nodePath: ['server', 'exemplo', 'tables', 'eventos'],
      // TIMESTAMP é mostrado no fuso da SESSÃO do banco (UTC no contêiner).
      esperado: { quando: GRAVADO, marcado: GRAVADO, dia: DIA },
    },
    {
      nome: 'PostgreSQL', type: 'postgres', porta: PG.porta, user: 'postgres',
      nodePath: ['server', 'exemplo', 'public', 'tables', 'eventos'],
      // TIMESTAMPTZ vem com o deslocamento — é o que o próprio psql mostra.
      esperado: { quando: GRAVADO, marcado: `${GRAVADO}+00`, dia: DIA },
    },
  ];

  // A mesma pergunta ao SQL Server: cada tipo de data dele, como ele mostra.
  const rms = await noMs('SELECT quando, fino, curto, dia, hora, comfuso FROM eventos');
  const lms = Object.fromEntries(rms.columns.map((col, i) => [col.name, rms.rows[0][i]]));
  // `datetime` guarda em passos de 1/300 s: o `.208` gravado vira `.207` NO
  // BANCO. O oráculo é o texto do próprio SQL Server, não o literal do INSERT.
  const oraculo = await noMs('SELECT CONVERT(varchar(23), quando, 121) FROM eventos');
  for (const [coluna, valor] of Object.entries({
    quando: oraculo.rows[0][0],
    fino: '2026-09-25 11:19:41.2084567',
    curto: '2026-09-25 11:19:00',
    dia: DIA,
    hora: '11:19:41.2084567',
    // O fuso gravado (−03:00) o driver descarta; sobra o instante, DITO em UTC.
    comfuso: '2026-09-25 14:19:41.208 +00:00',
  })) {
    marcar(`SQL Server: ${coluna} aparece como está gravado`, lms[coluna] === valor,
      `esperado ${JSON.stringify(valor)} · veio ${JSON.stringify(lms[coluna])}`);
  }

  for (const c of cenarios) {
    const conexao = await api('/api/connections', {
      type: c.type, label: `${c.nome} de exemplo`, group: 'Exemplos', readOnly: false,
      fields: { host: '127.0.0.1', port: c.porta, user: c.user, password: SENHA, main_database: 'exemplo' },
    });
    const r = await api(`/api/connections/${conexao.id}/execute`, {
      statement: 'SELECT id, quando, marcado, dia, nota FROM eventos', database: 'exemplo',
    });
    const linha = Object.fromEntries(r.columns.map((col, i) => [col.name, r.rows[0][i]]));
    for (const [coluna, valor] of Object.entries(c.esperado)) {
      marcar(`${c.nome}: ${coluna} aparece como está gravado`, linha[coluna] === valor,
        `esperado ${JSON.stringify(valor)} · veio ${JSON.stringify(linha[coluna])}`);
    }

    // **Editar pela grade**: o UPDATE leva o valor ANTIGO no WHERE (trava de
    // concorrência). Com a hora deslocada, ele não achava a linha.
    const escrita = await api(`/api/connections/${conexao.id}/table/write`, {
      nodePath: c.nodePath,
      alteracoes: [{ chave: { id: 1 }, antes: { quando: linha.quando }, depois: { quando: linha.quando.replace('.208', '.999') } }],
    }).then(() => 'gravou', (e) => `recusou: ${e.message}`);
    const depois = await api(`/api/connections/${conexao.id}/execute`, {
      statement: 'SELECT quando FROM eventos WHERE id = 1', database: 'exemplo',
    });
    marcar(`${c.nome}: editar a data pela grade grava o valor digitado`,
      depois.rows[0][0] === GRAVADO.replace('.208', '.999'),
      `${escrita} · no banco: ${JSON.stringify(depois.rows[0][0])}`);
  }
} catch (erro) {
  marcar('a verificação rodou até o fim', false, erro instanceof Error ? erro.message : String(erro));
} finally {
  motor?.kill();
  for (const nome of [MY.nome, PG.nome, MS.nome]) {
    try { docker('rm', '-f', nome); } catch { /* já não existia */ }
  }
  rmSync(casa, { recursive: true, force: true });
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
