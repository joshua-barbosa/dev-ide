// Cliente da API REST.
//
// Todas as respostas do servidor usam o envelope {success, data, error}; este
// módulo o desembrulha, de modo que o resto da interface só vê o dado ou uma
// exceção com a mensagem que o servidor mandou.
import type {
  ActionRequest,
  ActionResult,
  ConnectionInput,
  ConnectionsState,
  ExecuteRequest,
  PublicConnection,
  QueryResult,
  SessionCapabilities,
  TreeNode,
} from '../shared/contracts';
import type { DriverPanel, ConnectionKind, FieldSpec } from '../shared/contracts';
import type { PatchDePreferencias, Preferencias } from '../shared/prefs';

export interface DriverInfo {
  readonly type: string;
  readonly label: string;
  readonly kind: ConnectionKind;
  readonly panel: DriverPanel;
  readonly icon: string;
  readonly defaultPort?: number;
  readonly fields: readonly FieldSpec[];
  /** Se o driver tem cliente de linha de comando (habilita "abrir no terminal"). */
  readonly hasCli: boolean;
}

export interface Projeto {
  readonly name: string;
  readonly dir: string;
}

/** Uma parada do navegador de pastas. */
export interface ListagemDePastas {
  readonly path: string;
  readonly parent: string | null;
  readonly dirs: readonly { readonly name: string; readonly path: string }[];
}

/** Tudo que a interface precisa para desenhar o espaço de trabalho, de uma vez. */
export interface RetratoDoEspaco {
  readonly pasta: string | null;
  readonly recentes: readonly string[];
  readonly arvore: readonly FileNode[];
  readonly simbolos: readonly SymbolInfo[];
  readonly truncated: boolean;
}

export interface FileNode {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'dir';
  readonly children?: readonly FileNode[];
}

export interface SymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha de conexão com o servidor da IDE: ${detalhe}`);
  }

  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
  }

  if (!payload.success) {
    throw new Error(payload.error ?? `Erro do servidor (HTTP ${response.status}).`);
  }
  return payload.data;
}

/** Cada segmento vira um `path=` separado: ids e caminhos podem conter "/". */
function comCaminho(base: string, nodePath: readonly string[]): string {
  const qs = nodePath.map((p) => `path=${encodeURIComponent(p)}`).join('&');
  return qs === '' ? base : `${base}?${qs}`;
}

const conexoes = '/api/connections';

export const Api = {
  // ---- projetos e arquivos ----
  listProjects: () => request<Projeto[]>('GET', '/api/projects'),
  createProject: (name: string) =>
    request<{ name: string; dir: string }>('POST', '/api/projects', { name }),
  fileTree: (project: string) =>
    request<FileNode[]>('GET', `/api/projects/${encodeURIComponent(project)}/files`),
  createFile: (project: string, name: string, content: string) =>
    request<{ path: string }>('POST', `/api/projects/${encodeURIComponent(project)}/files`, {
      name,
      content,
    }),
  projectSymbols: (project: string) =>
    request<SymbolInfo[]>('GET', `/api/projects/${encodeURIComponent(project)}/symbols`),
  readFile: (path: string) =>
    request<{ path: string; content: string }>('GET', `/api/file?path=${encodeURIComponent(path)}`),
  saveFile: (path: string, content: string) =>
    request<{ path: string; bytes: number }>('POST', '/api/file', { path, content }),
  run: (payload: Record<string, unknown>) => request<RunResult>('POST', '/api/run', payload),

  // ---- espaço de trabalho (spec 012) ----
  browseFolders: (caminho?: string) =>
    request<ListagemDePastas>(
      'GET',
      caminho === undefined ? '/api/folders' : `/api/folders?path=${encodeURIComponent(caminho)}`
    ),
  workspace: () => request<RetratoDoEspaco>('GET', '/api/workspace'),
  openFolder: (path: string) => request<RetratoDoEspaco>('POST', '/api/workspace', { path }),
  closeFolder: () => request<RetratoDoEspaco>('DELETE', '/api/workspace'),
  forgetFolder: (path: string) =>
    request<RetratoDoEspaco>('DELETE', '/api/workspace/recent', { path }),
  createWorkspaceFile: (name: string, content: string) =>
    request<{ path: string }>('POST', '/api/workspace/file', { name, content }),

  // ---- preferências ----
  prefs: () => request<Preferencias>('GET', '/api/prefs'),
  setPrefs: (patch: PatchDePreferencias) =>
    request<Preferencias>('PATCH', '/api/prefs', patch),
  prefsPath: () => request<{ path: string }>('GET', '/api/prefs/file'),
  /** Cria o arquivo se preciso; devolve o caminho para abri-lo no editor. */
  prefsFile: () => request<{ path: string }>('POST', '/api/prefs/file'),

  // ---- conexões ----
  drivers: () => request<DriverInfo[]>('GET', `${conexoes}/drivers`),
  connections: () => request<ConnectionsState>('GET', conexoes),

  createVault: (password: string, remember = false) =>
    request('POST', `${conexoes}/vault`, { password, remember }),
  unlockVault: (password: string, remember = false) =>
    request('POST', `${conexoes}/vault/unlock`, { password, remember }),
  lockVault: () => request('POST', `${conexoes}/vault/lock`),

  createConnection: (input: ConnectionInput) =>
    request<PublicConnection>('POST', conexoes, input),
  updateConnection: (id: string, patch: Partial<ConnectionInput>) =>
    request<PublicConnection>('PATCH', `${conexoes}/${id}`, patch),
  deleteConnection: (id: string) => request('DELETE', `${conexoes}/${id}`),
  renameGroup: (from: string, to: string) =>
    request('POST', `${conexoes}/groups/rename`, { from, to }),

  connect: (id: string) => request<SessionCapabilities>('POST', `${conexoes}/${id}/connect`),
  disconnect: (id: string) => request('POST', `${conexoes}/${id}/disconnect`),
  children: (id: string, nodePath: readonly string[], filtro?: string | null) => {
    const base = comCaminho(`${conexoes}/${id}/children`, nodePath);
    const url = filtro === null || filtro === undefined || filtro === ''
      ? base
      : `${base}${base.includes('?') ? '&' : '?'}filter=${encodeURIComponent(filtro)}`;
    return request<TreeNode[]>('GET', url);
  },
  execute: (id: string, payload: ExecuteRequest) =>
    request<QueryResult>('POST', `${conexoes}/${id}/execute`, payload),
  runAction: (id: string, payload: ActionRequest) =>
    request<ActionResult>('POST', `${conexoes}/${id}/action`, payload),
};
