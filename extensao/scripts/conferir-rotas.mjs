// Confere, uma por uma, se as mensagens da webview são MESMO atendidas.
//
// Ele perguntou: *"verifique se todas as rotas realmente estão funcionando"*.
// Não dá para dirigir o VS Code daqui — mas dá para rodar o CÓDIGO DO HOST em
// Node puro, com um `vscode` de mentira, contra um motor de verdade. É onde os
// defeitos da spec 103 moravam, e nenhum teste os alcançava: alcançar exigia
// abrir o editor.
//
// Sobe o próprio motor, com cofre e SQLite descartáveis. Não encosta em nada
// do usuário.
//
//   npm run conferir:extensao
import Module from 'node:module';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const PORTA_MOTOR = 4479;
const PORTA_ECO = 4489;
const SENHA = 'senha-de-teste-1234';

const require_ = createRequire(`${RAIZ}/package.json`);
const original = Module._resolveFilename;
Module._resolveFilename = function (p, ...r) {
  return p === 'vscode'
    ? require_.resolve(path.join(import.meta.dirname, 'vscode-de-mentira.cjs'))
    : original.call(this, p, ...r);
};

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome.padEnd(40)} ${extra}`);

const esperarPorta = async (porta, rota = '/api/workspace') => {
  for (let i = 0; i < 120; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${porta}${rota}`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
};

const pasta = await mkdtemp(path.join(tmpdir(), 'braytech-conferir-'));
const filhos = [];
const encerrar = async () => {
  for (const p of filhos) p.kill('SIGTERM');
  await rm(pasta, { recursive: true, force: true });
};

try {
  // ---- o motor de teste, com dado inventado ----
  const banco = path.join(pasta, 'acme.db');
  const db = new DatabaseSync(banco);
  db.exec(
    `CREATE TABLE materias(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, carga INTEGER, obs TEXT);
     INSERT INTO materias(nome, carga, obs)
     VALUES ('Redação', 4, NULL), ('Álgebra', 6, 'turma piloto'), ('História', 3, NULL);`
  );
  db.close();

  filhos.push(
    spawn(process.execPath, [`${RAIZ}/dist/server/index.js`], {
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(PORTA_MOTOR),
        DEV_IDE_VAULT: path.join(pasta, 'vault.json'),
        DEV_IDE_SESSION: path.join(pasta, 'sessao.json'),
      },
    })
  );
  if (!(await esperarPorta(PORTA_MOTOR))) throw new Error('o motor de teste não subiu');

  const api = async (rota, corpo) =>
    (await fetch(`http://127.0.0.1:${PORTA_MOTOR}${rota}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      ...(corpo === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
    }).then((r) => r.json())).data;

  await api('/api/connections/vault', { password: SENHA });
  const conexao = await api('/api/connections', {
    type: 'sqlite', label: 'ACME local', group: 'ACME/Bancos', readOnly: false,
    fields: { file: banco },
  });

  // ---- o eco binário: prova a SUBIDA, que o SQLite não exercita ----
  filhos.push(
    spawn(process.execPath, [path.join(import.meta.dirname, 'eco-binario.mjs'), String(PORTA_ECO)], {
      stdio: 'ignore',
    })
  );
  if (!(await esperarPorta(PORTA_ECO, '/api/connections/drivers'))) {
    throw new Error('o eco binário não subiu');
  }

  const { PonteDoHost } = require_(`${RAIZ}/extensao/dist/ponteDoHost.js`);
  const { ligarMotor } = require_(`${RAIZ}/extensao/dist/motor.js`);

  /** Uma ponte ligada a um motor, com uma webview de mentira. */
  const montar = async (porta) => {
    const motor = await ligarMotor(porta, '');
    const respostas = [];
    const web = {
      onDidReceiveMessage(fn) { this._fn = fn; },
      postMessage(m) { respostas.push(m); return Promise.resolve(true); },
    };
    const deps = {
      motor, extensionUri: { fsPath: `${RAIZ}/extensao` },
      definirConexaoAtiva() {}, abrirQuery: async () => {}, abrirAbaDaIde() {},
      abrirFormulario() {}, abrirDialogo() {}, abrirDiagrama() {},
      recarregarPaineis() {}, abrirTerminal() {},
    };
    new PonteDoHost(deps, () => {}).ligar(web);

    let proximo = 1;
    return async (msg, esperaResposta = true) => {
      const id = proximo++;
      const antes = respostas.length;
      web._fn({ ...msg, ...(esperaResposta ? { id } : {}) });
      if (!esperaResposta) {
        await new Promise((r) => setTimeout(r, 120));
        return null;
      }
      for (let i = 0; i < 200; i += 1) {
        const achada = respostas.slice(antes).find((r) => r.id === id);
        if (achada !== undefined) return achada;
        await new Promise((r) => setTimeout(r, 50));
      }
      return { ok: false, erro: 'sem resposta em 10s' };
    };
  };

  const mandar = await montar(PORTA_MOTOR);
  const id = conexao.id;

  // ---- 1. as rotas de DADO ----
  for (const [nome, msg, medir] of [
    ['GET /connections', { metodo: 'GET', rota: '/api/connections' }],
    ['POST /connect', { metodo: 'POST', rota: `/api/connections/${id}/connect` }],
    ['GET /children', { metodo: 'GET', rota: `/api/connections/${id}/children` }, (d) => `${d.length} nós`],
    ['POST /execute', {
      metodo: 'POST', rota: `/api/connections/${id}/execute`,
      corpo: { statement: 'SELECT id, nome, obs FROM materias', database: 'main', rowLimit: 500 },
    }, (d) => `${d.rows.length} linhas`],
    ['GET /codebase', { metodo: 'GET', rota: `/api/connections/${id}/codebase?database=main` }],
    ['GET /prefs', { metodo: 'GET', rota: '/api/prefs' }],
    ['GET /workspace', { metodo: 'GET', rota: '/api/workspace' }],
  ]) {
    const r = await mandar({ tipo: 'api', ...msg });
    marcar(`api ${nome}`, r.ok === true, r.ok ? (medir?.(r.data) ?? '') : r.erro);
  }

  // ---- 2. a rota BINÁRIA de leitura ----
  const arquivo = path.join(pasta, 'enviado.txt');
  await writeFile(arquivo, 'bytes de teste\n');
  const cru = await mandar({
    tipo: 'apiBytes', metodo: 'GET', rota: `/api/file/raw?path=${encodeURIComponent(arquivo)}`,
  });
  marcar('apiBytes GET /file/raw', cru.ok === true, cru.ok ? `${Buffer.from(cru.data, 'base64').length} bytes` : cru.erro);
  marcar(
    'os bytes voltaram intactos',
    cru.ok && Buffer.from(cru.data, 'base64').toString('utf8') === 'bytes de teste\n'
  );

  // ---- 3. as chamadas ao host ----
  global.__RESPOSTAS = { showInputBox: 'nome-digitado' };
  for (const [nome, acao, args] of [
    ['pedirTexto', 'pedirTexto', { titulo: 't' }],
    ['pedirSenha', 'pedirSenha', { titulo: 't' }],
    ['escreverNaSaida', 'escreverNaSaida', { texto: 'oi', erro: false }],
    ['mostrarSaida', 'mostrarSaida', {}],
  ]) {
    const r = await mandar({ tipo: 'hostChamada', acao, args });
    marcar(`host ${nome}`, r.ok === true, r.ok ? '' : r.erro);
  }

  global.__RESPOSTAS = { showQuickPick: { valor: 'sim', rotulo: 'Sim' } };
  const escolha = await mandar({
    tipo: 'hostChamada', acao: 'escolher',
    args: { titulo: 't', opcoes: [{ valor: 'sim', rotulo: 'Sim' }] },
  });
  marcar('host escolher', escolha.ok === true, escolha.ok ? String(escolha.data) : escolha.erro);

  const salvo = path.join(pasta, 'salvo.txt');
  global.__RESPOSTAS = { showSaveDialog: { fsPath: salvo, path: salvo, scheme: 'file' } };
  const sv = await mandar({
    tipo: 'hostChamada', acao: 'salvarArquivo',
    args: { nome: 'salvo.txt', carga: Buffer.from('conteúdo salvo\n').toString('base64') },
  });
  marcar('host salvarArquivo', sv.ok === true, sv.ok ? '' : sv.erro);
  marcar('o arquivo salvo bate', sv.ok && (await readFile(salvo, 'utf8')) === 'conteúdo salvo\n');

  global.__RESPOSTAS = { showOpenDialog: [{ fsPath: arquivo, path: arquivo, scheme: 'file' }] };
  const um = await mandar({ tipo: 'hostChamada', acao: 'escolherArquivo', args: { extensoes: ['txt'] } });
  marcar('host escolherArquivo', um.ok && um.data?.nome === 'enviado.txt', um.ok ? um.data?.nome : um.erro);
  const varios = await mandar({
    tipo: 'hostChamada', acao: 'escolherArquivo', args: { extensoes: [], varios: true },
  });
  marcar('host escolherArquivo (vários)', varios.ok && Array.isArray(varios.data),
    varios.ok ? JSON.stringify(varios.data?.map?.((a) => a.nome)) : varios.erro);

  const inventada = await mandar({ tipo: 'hostChamada', acao: 'inventada', args: {} });
  marcar('ação desconhecida é RECUSADA', inventada.ok === false, String(inventada.erro));

  // ---- 4. os pedidos sem resposta: nenhum pode virar erro na tela ----
  for (const [nome, msg] of [
    ['abrirTabela', { tipo: 'abrirTabela', connectionId: id, nodePath: ['main', 'materias'], titulo: 'materias', database: 'main', somenteLeitura: false }],
    ['abrirServidor', { tipo: 'abrirServidor', connectionId: id, rotulo: 'ACME', somenteLeitura: false }],
    ['abrirProcessos', { tipo: 'abrirProcessos', connectionId: id, rotulo: 'ACME', somenteLeitura: false }],
    ['abrirChave', { tipo: 'abrirChave', connectionId: id, chave: 'k', somenteLeitura: false }],
    ['abrirTerminal', { tipo: 'abrirTerminal', connectionId: id, rotulo: 'ACME' }],
    ['abrirDiagrama', { tipo: 'abrirDiagrama', titulo: 'd', markdown: '# d' }],
    ['abrirFormulario', { tipo: 'abrirFormulario', conexaoId: id, grupo: '', rotulo: 'x' }],
    ['abrirQuery', { tipo: 'abrirQuery', connectionId: id, database: 'main', titulo: 'q.sql', conteudo: 'SELECT 1' }],
    ['abrirSemTitulo', { tipo: 'abrirSemTitulo', conteudo: 'x', linguagem: 'sql' }],
    ['conexoesMudaram', { tipo: 'conexoesMudaram' }],
    ['avisar', { tipo: 'avisar', mensagem: 'oi' }],
    ['copiar', { tipo: 'copiar', texto: 'copiado' }],
  ]) {
    global.__CHAMADAS.length = 0;
    await mandar(msg, false);
    const erros = global.__CHAMADAS.filter((c) => c.o === 'erro').map((c) => c.m);
    marcar(nome, erros.length === 0,
      erros.join(' | ') || global.__CHAMADAS.map((c) => c.o).join(', ') || '(só repassa)');
  }

  // ---- 5. a SUBIDA binária, contra o eco ----
  const mandarAoEco = await montar(PORTA_ECO);
  const carga = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a, 0x7b]);
  const ida = await mandarAoEco({
    tipo: 'apiBytes', metodo: 'POST', rota: '/api/x/files/upload', carga: carga.toString('base64'),
  });
  marcar('POST binário volta intacto',
    ida.ok && Buffer.from(ida.data, 'base64').equals(carga),
    ida.ok ? Buffer.from(ida.data, 'base64').toString('hex') : ida.erro);

  const grande = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < grande.length; i += 1) grande[i] = i % 256;
  const g = await mandarAoEco({
    tipo: 'apiBytes', metodo: 'POST', rota: '/api/x/files/upload', carga: grande.toString('base64'),
  });
  marcar('3 MB atravessam sem corromper',
    g.ok && Buffer.from(g.data, 'base64').equals(grande), g.ok ? `${grande.length} bytes` : g.erro);

  const sucessoJson = await mandarAoEco({
    tipo: 'apiBytes', metodo: 'POST', rota: '/api/x/files/upload?sucessoJson=1',
    carga: carga.toString('base64'),
  });
  marcar('sucesso em JSON NÃO vira erro', sucessoJson.ok === true, sucessoJson.ok ? '' : sucessoJson.erro);

  const recusa = await mandarAoEco({ tipo: 'apiBytes', metodo: 'GET', rota: '/api/x/files/bytes?erro=1' });
  marcar('erro do motor chega com a mensagem',
    recusa.ok === false && String(recusa.erro).includes('o motor recusou'), String(recusa.erro));
} finally {
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  await encerrar();
  process.exit(falhas === 0 ? 0 : 1);
}
