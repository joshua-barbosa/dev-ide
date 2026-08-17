import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { registerBuiltinDrivers } from './connections/drivers';
import { SessionPool } from './connections/pool';
import { DriverRegistry } from './connections/registry';
import { Vault } from './connections/vault';
import { RememberedKey, restaurarCofre } from './connections/remember';
import { errorEnvelope, requireString, wrap } from './http/handlers';
import { localhostOnly } from './http/security';
import { ProjectStore } from './projects';
import { createConnectionsRouter } from './routes/connections';
import { TerminalRegistry } from './terminal/registry';
import { montarSocketDeTerminal } from './terminal/socket';
import { criarResolvedorDeAbertura } from './terminal/abertura';
import { runCode, RunRequest } from './runner';
import { extractSymbols, SymbolInfo } from './symbols';

const PORT = Number(process.env.PORT ?? 4321);
const HOST = '127.0.0.1';
const IDLE_SWEEP_MS = 60_000;
const ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS_DIR = process.env.DEV_IDE_PROJECTS ?? path.join(ROOT, 'projects');
const SYMBOL_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.php', '.c', '.h', '.cs',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const store = new ProjectStore(PROJECTS_DIR);
store.ensureBaseDir();

// ---- Conexões (banco, redis, arquivos remotos, ssh) ----
const registry = registerBuiltinDrivers(new DriverRegistry());
const vault = new Vault(process.env.DEV_IDE_VAULT ?? Vault.defaultPath());
const pool = new SessionPool(async (connectionId) => {
  const config = vault.resolve(connectionId);
  return registry.get(config.type).connect(config);
});

const remember = new RememberedKey(
  process.env.DEV_IDE_SESSION ?? RememberedKey.defaultPath()
);
restaurarCofre(vault, remember);

// ---- Terminal ----
const terminais = new TerminalRegistry();
const resolverAbertura = criarResolvedorDeAbertura({
  registry,
  vault,
  cwdPadrao: () => PROJECTS_DIR,
});

// A interface é compilada pelo Vite de src/ui para dist/ui.
const UI_DIR = path.join(ROOT, 'dist', 'ui');

const app = express();
app.use(localhostOnly);
app.use(express.json({ limit: '4mb' }));
app.use(express.static(UI_DIR));
app.use('/api/connections', createConnectionsRouter({ registry, vault, pool, remember }));

function validateFilePath(raw: string): string {
  const resolved = path.resolve(raw);
  if (raw.includes('\0')) throw new Error('Caminho inválido.');
  return resolved;
}

// ---- Projetos ----
app.get('/api/projects', wrap((_req, res) => {
  res.json({ success: true, data: store.listProjects(), error: null });
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
  const files = store.projectFiles(req.params.name, SYMBOL_EXTENSIONS);
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

app.post('/api/file', wrap((req, res) => {
  const filePath = validateFilePath(requireString(req.body?.path, 'path'));
  const content = req.body?.content;
  if (typeof content !== 'string') {
    throw new Error('Campo obrigatório ausente ou inválido: "content".');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  res.json({ success: true, data: { path: filePath, bytes: Buffer.byteLength(content) }, error: null });
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
  };
  const result = await runCode(request);
  res.json({ success: true, data: result, error: null });
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
  montarSocketDeTerminal(server, { registry: terminais, resolverAbertura });

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
