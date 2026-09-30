// `{{nome}}` do notebook nos TRÊS bancos de rede (spec 112, etapa 4).
//
// Cada banco tem o seu marcador: `?` no MySQL, `$1` no PostgreSQL, `@p1` no
// SQL Server (este com TIPO por parâmetro). O SQLite, que a suíte cobre, só
// prova o primeiro. Aqui: bancos descartáveis em Docker, um kernel Python de
// verdade, uma lista (`IN {{ids}}`) e um texto com aspas e tentativa de injeção.
//
//   npm run build && npm run conferir:parametros     (exige Docker; ~1 min)
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const MOTOR = process.env.MOTOR ?? path.join(RAIZ, 'dist/server/index.js');
const SUFIXO = String(process.pid);
const SENHA = 'senha-de-teste';
const MS_SENHA = 'Senha-de-teste-1234';
const BANCOS = [
  { tipo: 'mysql', nome: `braytech-param-my-${SUFIXO}`, porta: 3396, user: 'root', senha: SENHA, db: 'exemplo',
    imagem: 'mysql:8', env: [`MYSQL_ROOT_PASSWORD=${SENHA}`, 'MYSQL_DATABASE=exemplo'], interna: 3306 },
  { tipo: 'postgres', nome: `braytech-param-pg-${SUFIXO}`, porta: 5496, user: 'postgres', senha: SENHA, db: 'exemplo',
    imagem: 'postgres:16', env: [`POSTGRES_PASSWORD=${SENHA}`, 'POSTGRES_DB=exemplo'], interna: 5432 },
  { tipo: 'sqlserver', nome: `braytech-param-ms-${SUFIXO}`, porta: 1496, user: 'sa', senha: MS_SENHA, db: 'master',
    imagem: 'mcr.microsoft.com/mssql/server:2022-latest', env: ['ACCEPT_EULA=Y', `MSSQL_SA_PASSWORD=${MS_SENHA}`], interna: 1433 },
];
const PORTA = 4509;
const casa = mkdtempSync(path.join(tmpdir(), 'braytech-param-'));
const pasta = path.join(casa, 'projeto');
mkdirSync(pasta);
const caminho = path.join(pasta, 'analise.brnb');

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome}${extra === '' ? '' : `  ${extra}`}`);
const docker = (...a) => execFileSync('docker', a, { stdio: 'pipe' }).toString();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let motor;
try {
  for (const b of BANCOS) {
    docker('run', '-d', '--name', b.nome, ...b.env.flatMap((e) => ['-e', e]), '-p', `${b.porta}:${b.interna}`, b.imagem);
  }
  motor = spawn(process.execPath, [MOTOR], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORTA), DEV_IDE_HOME: path.join(casa, 'casa'),
      DEV_IDE_VAULT: path.join(casa, 'vault.json'), DEV_IDE_SESSION: path.join(casa, 'sessao.json') },
  });
  const api = async (rota, corpo) => {
    const r = await fetch(`http://127.0.0.1:${PORTA}${rota}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      ...(corpo === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
    }).then((x) => x.json());
    if (r.success !== true) throw new Error(r.error ?? 'erro sem mensagem');
    return r.data;
  };
  for (let i = 0; i < 100; i++) {
    try { await api('/api/connections/drivers'); break; } catch { await esperar(200); }
  }
  await api('/api/connections/vault', {});

  // Um kernel Python com os valores que a célula SQL vai pedir.
  await api('/api/notebook/kernel', { caminho, linguagem: 'python', raiz: pasta });
  const { exec } = await api('/api/notebook/kernel/executar', {
    caminho, codigo: 'ids = [1, 3]\nnome = "Bia\'; DROP TABLE clientes; --"\nminimo = 2',
  });
  for (let i = 0; i < 100; i++) {
    const q = await api(`/api/notebook/kernel/execucao?caminho=${encodeURIComponent(caminho)}&exec=${exec}&desde=0`);
    if (q.terminou) break;
    await esperar(50);
  }

  for (const b of BANCOS) {
    const c = await api('/api/connections', {
      type: b.tipo, label: b.tipo, group: 'Exemplos', readOnly: false,
      fields: { host: '127.0.0.1', port: b.porta, user: b.user, password: b.senha, main_database: b.db },
    });
    const sql = (statement, nome = null) => api('/api/notebook/kernel/sql', {
      caminho, connectionId: c.id, database: b.db, statement, nome,
    });
    let pronto = false;
    for (let i = 0; i < 120 && !pronto; i++) {
      try { await sql('SELECT 1'); pronto = true; } catch { await esperar(1000); }
    }
    if (!pronto) throw new Error(`${b.tipo} não subiu`);
    await sql('CREATE TABLE clientes (id INT PRIMARY KEY, nome VARCHAR(50))');
    await sql("INSERT INTO clientes VALUES (1, 'Ana'), (2, 'Bia'), (3, 'Caio')");

    const lista = await sql('SELECT nome FROM clientes WHERE id IN {{ids}} ORDER BY id');
    marcar(`${b.tipo}: lista vira IN com os marcadores dele`,
      JSON.stringify(lista.tabela.linhas) === '[["Ana"],["Caio"]]', JSON.stringify(lista.tabela.linhas));

    const numero = await sql('SELECT nome FROM clientes WHERE id >= {{minimo}} ORDER BY id');
    marcar(`${b.tipo}: número como parâmetro`,
      JSON.stringify(numero.tabela.linhas) === '[["Bia"],["Caio"]]', JSON.stringify(numero.tabela.linhas));

    const injecao = await sql('SELECT nome FROM clientes WHERE nome = {{nome}}');
    const contagem = await sql('SELECT count(*) FROM clientes');
    marcar(`${b.tipo}: aspas e injeção viram TEXTO — nada apagado`,
      injecao.tabela.total === 0 && Number(contagem.tabela.linhas[0][0]) === 3,
      `achou ${injecao.tabela.total}, tabela com ${contagem.tabela.linhas[0][0]}`);
  }
} catch (erro) {
  marcar('a verificação rodou até o fim', false, erro instanceof Error ? erro.message : String(erro));
} finally {
  motor?.kill();
  for (const b of BANCOS) {
    try { docker('rm', '-f', b.nome); } catch { /* já não existia */ }
  }
  rmSync(casa, { recursive: true, force: true });
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}
