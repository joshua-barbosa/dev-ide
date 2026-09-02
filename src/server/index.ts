import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { registerBuiltinDrivers } from './connections/drivers';
import { SessionPool } from './connections/pool';
import { DriverRegistry } from './connections/registry';
import { Vault } from './connections/vault';
import { diasDeLembranca, RememberedKey, restaurarCofre } from './connections/remember';
import { errorEnvelope, requireString, wrap } from './http/handlers';
import { localhostOnly } from './http/security';
import { PreferencesStore } from './prefs';
import { ProjectStore } from './projects';
import { createConnectionsRouter } from './routes/connections';
import { createPrefsRouter } from './routes/prefs';
import { createWorkspaceRouter } from './routes/workspace';
import { createComandosRouter } from './routes/comandos';
import { ComandosStore } from './comandos';
import { createSnippetsRouter } from './routes/snippets';
import { createFormatarRouter } from './routes/formatar';
import { createBuscaRouter } from './routes/busca';
import { createQueriesRouter } from './routes/queries';
import { VinculosStore } from './vinculos';
import { createLinguagemRouter } from './routes/linguagem';
import { SnippetsStore } from './snippets';
import { HistoricoStore } from './historico';
import { pastaPrincipal } from '../shared/estado';
import { EstadoStore } from './estado';
import { TerminalRegistry } from './terminal/registry';
import { CanalSsh } from './terminal/canal-ssh';
import { montarSocketDeTerminal } from './terminal/socket';
import { montarSocketDoVigia } from './vigia-socket';
import { criarResolvedorDeAbertura } from './terminal/abertura';
import { runCode, RunRequest } from './runner';
import { RegistroDeExecucoes } from './execucoes';
import { EXTENSOES_DE_SIMBOLO, extractSymbols, SymbolInfo } from './symbols';

const PORT = Number(process.env.PORT ?? 4321);
const HOST = '127.0.0.1';
const IDLE_SWEEP_MS = 60_000;
const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_DIR = process.env.DEV_IDE_PROJECTS ?? path.join(ROOT, 'projects');
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const store = new ProjectStore(PROJECTS_DIR);
store.ensureBaseDir();

// ---- Espaço de trabalho (pasta aberta, recentes) ----
const estado = new EstadoStore(EstadoStore.defaultPath());

// ---- Preferências ----
// A raiz entra como FUNÇÃO: o projeto aberto muda em execução, e as
// preferências dele (T002) precisam acompanhar sem reiniciar o servidor. Com
// mais de uma raiz (T004), vale a PRIMEIRA — preferência é do espaço, e somar
// dois `.vscode/settings.json` daria conflito sem regra de desempate.
const prefs = new PreferencesStore(PreferencesStore.defaultPath(), () =>
  pastaPrincipal(estado.ler())
);
const comandos = new ComandosStore(ComandosStore.defaultPath());
const snippets = new SnippetsStore(SnippetsStore.defaultPath(), () => pastaPrincipal(estado.ler()));
/** Versões locais dos arquivos: o Timeline e o rascunho não salvo (T010, T035). */
const historico = new HistoricoStore(HistoricoStore.defaultPath());

// ---- Execuções em andamento (para poder parar) ----
const execucoes = new RegistroDeExecucoes();

// ---- Conexões (banco, redis, arquivos remotos, ssh) ----
const registry = registerBuiltinDrivers(new DriverRegistry());
const vinculos = new VinculosStore();
const vault = new Vault(process.env.DEV_IDE_VAULT ?? Vault.defaultPath());
const pool = new SessionPool(async (connectionId) => {
  const config = vault.resolve(connectionId);
  return registry.get(config.type).connect(config);
});

const remember = new RememberedKey(
  process.env.DEV_IDE_SESSION ?? RememberedKey.defaultPath()
);
// O prazo vai junto (T101): destrancar pela lembrança RENOVA a lembrança, e
// quem usa a IDE todo dia não redigita a senha mestra. Quem some pelo prazo
// inteiro continua tendo que digitar — é o que o prazo existe para garantir.
restaurarCofre(vault, remember, diasDeLembranca(process.env, prefs.ler()['vault.rememberDays']));

// ---- Terminal ----
const terminais = new TerminalRegistry();
const resolverAbertura = criarResolvedorDeAbertura({
  registry,
  vault,
  // A pasta ABERTA, e não a de projetos: desde a spec 012 o espaço de trabalho
  // é qualquer pasta, e um terminal que nasce noutro lugar faz `npm run build`
  // rodar no projeto errado — ou em nenhum.
  cwdPadrao: () => pastaPrincipal(estado.ler()) ?? PROJECTS_DIR,
});

// A interface é compilada pelo Vite de src/ui para dist/ui.
const UI_DIR = path.join(ROOT, 'dist', 'ui');

const app = express();
app.use(localhostOnly);
app.use(express.json({ limit: '4mb' }));
app.use(express.static(UI_DIR));
app.use('/api/connections', createConnectionsRouter({ registry, vault, pool, remember, prefs }));
app.use('/api/prefs', createPrefsRouter(prefs));
app.use('/api', createWorkspaceRouter(estado, ROOT));
app.use('/api/commands', createComandosRouter(comandos, estado));
app.use('/api/snippets', createSnippetsRouter(snippets));
app.use('/api/search', createBuscaRouter(estado));
app.use('/api/format', createFormatarRouter());
app.use(
  '/api/queries',
  createQueriesRouter({
    vinculos,
    // Lembrança de conexão apagada não pode sobreviver à conexão (AC-11).
    idsDeConexao: () => vault.list().map((c) => c.id),
  })
);
app.use('/api/language', createLinguagemRouter(estado));

function validateFilePath(raw: string): string {
  const resolved = path.resolve(raw);
  if (raw.includes('\0')) throw new Error('Caminho inválido.');
  return resolved;
}

// ---- Projetos ----
// Nome **e** caminho: desde a spec 012 a interface abre pasta por caminho, e
// os projetos viraram atalhos para dentro de `projects/`.
app.get('/api/projects', wrap((_req, res) => {
  const dados = store.listProjects().map((name) => ({ name, dir: store.projectDir(name) }));
  res.json({ success: true, data: dados, error: null });
}));

app.post('/api/projects', wrap((req, res) => {
  const name = requireString(req.body?.name, 'name').trim();
  const dir = store.createProject(name);
  res.status(201).json({ success: true, data: { name, dir }, error: null });
}));

app.get('/api/projects/:name/files', wrap((req, res) => {
  res.json({ success: true, data: store.fileTree(req.params.name), error: null });
}));

app.post('/api/projects/:name/files', wrap((req, res) => {
  const dir = store.projectDir(req.params.name);
  const relative = requireString(req.body?.name, 'name').trim();
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const filePath = path.resolve(dir, relative);
  if (!filePath.startsWith(dir + path.sep)) {
    throw new Error('O arquivo precisa ficar dentro da pasta do projeto.');
  }
  if (fs.existsSync(filePath)) {
    throw new Error(`O arquivo "${relative}" já existe no projeto.`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  res.status(201).json({ success: true, data: { path: filePath }, error: null });
}));

app.get('/api/projects/:name/symbols', wrap((req, res) => {
  const files = store.projectFiles(req.params.name, EXTENSOES_DE_SIMBOLO);
  const symbols: SymbolInfo[] = [];
  for (const file of files) {
    try {
      symbols.push(...extractSymbols(file, fs.readFileSync(file, 'utf8')));
    } catch {
      // arquivo ilegível ou binário: ignora e segue com os demais
    }
  }
  res.json({ success: true, data: symbols, error: null });
}));

// ---- Arquivos ----
app.get('/api/file', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.query.path, 'path'));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }
  if (fs.statSync(filePath).size > MAX_FILE_BYTES) {
    throw new Error('Arquivo muito grande para abrir no editor (limite de 2 MB).');
  }
  res.json({
    success: true,
    data: { path: filePath, content: fs.readFileSync(filePath, 'utf8') },
    error: null,
  });
}));

/**
 * O arquivo como BYTES, para imagem e PDF (T027).
 *
 * Separada do `/api/file` de propósito: aquela devolve texto em JSON, e passar
 * um PNG por ali significaria decodificá-lo como UTF-8 — o que o corrompe — ou
 * embrulhá-lo em base64, que infla um terço e ainda passa pela memória do
 * navegador inteiro antes de virar imagem.
 *
 * A cerca é a MESMA (`validateFilePath`): o caminho vem do cliente, e o que
 * separa "ver uma imagem do projeto" de "ler qualquer arquivo da máquina" é
 * exatamente essa função.
 *
 * O teto também é maior aqui: 2 MB é razoável para o editor e pequeno para um
 * PDF de manual.
 */
const MAX_BYTES_BRUTOS = 64 * 1024 * 1024;

const TIPOS: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  svg: 'image/svg+xml', pdf: 'application/pdf',
};

app.get('/api/file/raw', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.query.path, 'path'));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }
  const tamanho = fs.statSync(filePath).size;
  if (tamanho > MAX_BYTES_BRUTOS) {
    throw new Error('Arquivo muito grande para abrir (limite de 64 MB).');
  }

  const ponto = filePath.toLowerCase().lastIndexOf('.');
  const ext = ponto === -1 ? '' : filePath.toLowerCase().slice(ponto + 1);
  const tipo = TIPOS[ext] ?? 'application/octet-stream';

  // `Content-Disposition: inline` para o navegador MOSTRAR em vez de baixar —
  // é o ponto inteiro. E `X-Content-Type-Options` porque o tipo sai de uma
  // tabela nossa: sem ele o navegador poderia adivinhar outro e tratar um
  // arquivo como script.
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Nada de cache: o arquivo é local e pode mudar a qualquer momento — servir
  // a versão velha depois de salvar seria a pior surpresa.
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(filePath).pipe(res);
}));

app.post('/api/file', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.body?.path, 'path'));
  const content = req.body?.content;
  if (typeof content !== 'string') {
    throw new Error('Campo obrigatório ausente ou inválido: "content".');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  // Uma versão local a cada save (T010). O `guardar` decide se vale: texto
  // idêntico ao da última não vira linha nova no Timeline. Falha aqui NÃO
  // derruba o save — o arquivo já está no disco, e perder o histórico é menos
  // grave que devolver erro para quem acabou de salvar com sucesso.
  try {
    historico.guardar(filePath, content, 'salvo');
  } catch {
    // Ver acima: o save venceu, e é isso que importa.
  }
  res.json({ success: true, data: { path: filePath, bytes: Buffer.byteLength(content) }, error: null });
}));

// ---- Histórico local: o Timeline e o rascunho (T010, T035) ----

app.get('/api/history', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.query.path, 'path'));
  res.json({ success: true, data: historico.listar(filePath), error: null });
}));

app.get('/api/history/version', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.query.path, 'path'));
  const versao = historico.ler(filePath, requireString(req.query.id, 'id'));
  if (versao === null) throw new Error('Esta versão não está mais no histórico.');
  res.json({ success: true, data: versao, error: null });
}));

/**
 * Guarda o rascunho de um arquivo sujo (T035).
 *
 * Chamada no `pagehide`, por `sendBeacon` — e é por isso que ela responde
 * qualquer coisa rápido: o navegador está indo embora, e uma resposta demorada
 * seria descartada junto com a página.
 */
app.post('/api/history/draft', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.body?.path, 'path'));
  const content = req.body?.content;
  if (typeof content !== 'string') {
    throw new Error('Campo obrigatório ausente ou inválido: "content".');
  }
  const versao = historico.guardar(filePath, content, 'rascunho');
  res.json({ success: true, data: versao, error: null });
}));

/** Os arquivos que ficaram com trabalho não salvo — a pergunta ao abrir. */
app.get('/api/history/drafts', wrap((_req, res) => {
  res.json({ success: true, data: historico.arquivosComRascunho(), error: null });
}));

app.delete('/api/history/draft', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.body?.path, 'path'));
  historico.descartarRascunho(filePath);
  res.json({ success: true, data: { path: filePath }, error: null });
}));

// ---- Execução ----
app.post('/api/run', wrap(async (req, res) => {
  const body = req.body ?? {};
  const mode = requireString(body.mode, 'mode');
  if (!['file', 'block', 'function'].includes(mode)) {
    throw new Error(`Modo de execução inválido: "${mode}".`);
  }
  if (body.args !== undefined && !Array.isArray(body.args)) {
    throw new Error('O campo "args" deve ser um array JSON.');
  }
  const request: RunRequest = {
    mode: mode as RunRequest['mode'],
    filePath: typeof body.filePath === 'string' ? validateFilePath(body.filePath) : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
    functionName: typeof body.functionName === 'string' ? body.functionName : undefined,
    args: body.args,
    language: typeof body.language === 'string' ? body.language : undefined,
    runId: typeof body.runId === 'string' ? body.runId : undefined,
  };
  const result = await runCode(request, execucoes);
  res.json({ success: true, data: result, error: null });
}));

/**
 * Encerra uma execução em andamento.
 *
 * `parou: false` não é erro: clicar em parar duas vezes, ou parar o que já
 * terminou, é comportamento normal de quem está com pressa.
 */
app.post('/api/run/:id/stop', wrap((req, res) => {
  res.json({ success: true, data: { parou: execucoes.parar(req.params.id) }, error: null });
}));

// ---- Erros ----
app.use(errorEnvelope);

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`dev-ide rodando em http://localhost:${PORT} (apenas ${HOST})`);
    console.log(`Projetos em: ${PROJECTS_DIR}`);
    if (!fs.existsSync(path.join(UI_DIR, 'index.html'))) {
      // Acontece depois de `npm test`, que limpa dist/ e recompila só o servidor.
      console.warn('Interface não compilada. Rode "npm run build:ui" (ou "npm run dev").');
    }
  });

  // O socket compartilha o servidor HTTP: mesma porta, mesma guarda de origem.
  montarSocketDeTerminal(server, {
    registry: terminais,
    resolverAbertura,
    // O terminal de uma conexão que tem canal próprio (SSH, spec 054): abre um
    // canal na sessão que já está autenticada, em vez de um processo local —
    // e por isso nenhuma senha vai para linha de comando nem arquivo temporário.
    abrirCanalDaConexao: async (pedido) => {
      const p = (pedido ?? {}) as { connectionId?: unknown; cols?: unknown; rows?: unknown };
      if (typeof p.connectionId !== 'string' || p.connectionId === '') {
        throw new Error('Sem conexão para abrir o terminal.');
      }
      const sessao = await pool.acquire(p.connectionId);
      if (sessao.shell === undefined) throw new Error('Esta conexão não tem terminal.');
      const cols = typeof p.cols === 'number' && p.cols > 0 ? Math.trunc(p.cols) : 80;
      const rows = typeof p.rows === 'number' && p.rows > 0 ? Math.trunc(p.rows) : 24;
      return new CanalSsh(await sessao.shell.open({ cols, rows }));
    },
  });
  montarSocketDoVigia(server, estado);

  const sweeper = setInterval(() => {
    pool.sweep().catch((err: Error) => console.error('Falha ao fechar sessões ociosas:', err.message));
  }, IDLE_SWEEP_MS);
  sweeper.unref();

  for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sinal, () => {
      clearInterval(sweeper);
      // Terminais primeiro: são processos de fora, e ficariam órfãos com o
      // arquivo de credencial ainda em disco.
      terminais.fecharTodos();
      execucoes.pararTudo();
      pool.closeAll().finally(() => server.close(() => process.exit(0)));
    });
  }
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `A porta ${PORT} já está em uso (provavelmente outra instância da dev-ide).\n` +
          `Encerre-a com "fuser -k ${PORT}/tcp" ou inicie em outra porta: "PORT=4322 npm start".`
      );
      process.exit(1);
    }
    throw err;
  });
}

export { app, store };
