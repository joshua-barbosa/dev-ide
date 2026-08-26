// Cliente da API REST.
//
// Todas as respostas do servidor usam o envelope {success, data, error}; este
// módulo o desembrulha, de modo que o resto da interface só vê o dado ou uma
// exceção com a mensagem que o servidor mandou.
import type {
  ActionRequest,
  ActionResult,
  AlterCapabilities,
  AlterRequest,
  AlterResult,
  ConnectionInput,
  ConnectionsState,
  ExecuteRequest,
  ProcessoDoBanco,
  PublicConnection,
  QueryResult,
  SessionCapabilities,
  TablePage,
  TableRequest,
  TableStructure,
  TableWriteRequest,
  TableWriteResult,
  TreeNode,
  CellRequest,
  CellResult,
  OrdenacaoDeTabela,
  FiltroDeTabela,
  ColumnInfo,
  CellValue,
} from '../shared/contracts';
import type { SnippetDeTerminal } from '../shared/terminal/snippets';
import type {
  DriverPanel,
  ConnectionKind,
  FieldSpec,
  HostMetrics,
  PortForward,
  RemoteEntry,
} from '../shared/contracts';
import type { PatchDePreferencias, Preferencias } from '../shared/prefs';
import type { ArquivoDeQuery, Vinculo } from '../shared/sql/vinculo';
import type {
  ComandoDescoberto, ComandoSalvo, DestinoDeComando,
} from '../shared/comandos-salvos';
import type { Snippet } from '../shared/snippets';
import type { ArquivoComOcorrencias, OpcoesDeBusca } from '../shared/busca';

export interface ResultadoDaBusca {
  readonly arquivos: readonly ArquivoComOcorrencias[];
  readonly totalDeOcorrencias: number;
  /** Algum teto cortou a varredura — a lista não está completa. */
  readonly truncado: boolean;
  readonly arquivosVisitados: number;
}

export interface ListaDeComandos {
  readonly salvos: readonly ComandoSalvo[];
  readonly descobertos: readonly ComandoDescoberto[];
}

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
  /** Abre terminal — por cliente local ou por canal da própria conexão. */
  readonly hasTerminal: boolean;
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
  /** O `.gitignore` manda ignorar: a árvore mostra, mas em cinza (spec 036). */
  readonly ignored?: boolean;
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
  /** Encerrado pelo usuário — distinto de tempo esgotado. */
  readonly cancelled: boolean;
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

export interface Alvo {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  readonly previa: string;
}

export interface PerguntaDeCodigo {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  /** O que está na tela, quando difere do disco. */
  readonly conteudo?: string;
}

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
  stopRun: (id: string) =>
    request<{ parou: boolean }>('POST', `/api/run/${encodeURIComponent(id)}/stop`),

  // ---- comandos salvos (spec 018) ----
  commands: () => request<ListaDeComandos>('GET', '/api/commands'),
  createCommand: (nome: string, comando: string, destino: DestinoDeComando) =>
    request<ComandoSalvo>('POST', '/api/commands', { nome, comando, destino }),
  deleteCommand: (id: string) =>
    request<{ removido: boolean }>('DELETE', `/api/commands/${encodeURIComponent(id)}`),

  // ---- snippets (spec 019) ----
  snippets: () => request<Snippet[]>('GET', '/api/snippets'),
  createSnippet: (dados: Omit<Snippet, 'id'>) =>
    request<Snippet>('POST', '/api/snippets', dados),
  deleteSnippet: (id: string) =>
    request<{ removido: boolean }>('DELETE', `/api/snippets/${encodeURIComponent(id)}`),

  // ---- busca em arquivos (spec 027) ----
  search: (termo: string, opcoes: OpcoesDeBusca) =>
    request<ResultadoDaBusca>('POST', '/api/search', { termo, ...opcoes }),
  replaceInFiles: (
    termo: string,
    opcoes: OpcoesDeBusca,
    substituto: string,
    caminhos: readonly string[]
  ) =>
    request<{ arquivosAlterados: number; trocas: number }>('POST', '/api/search/replace', {
      termo,
      ...opcoes,
      substituto,
      caminhos,
    }),

  // ---- navegação por código (spec 032) ----
  definition: (pergunta: PerguntaDeCodigo) =>
    request<{ alvos: Alvo[] }>('POST', '/api/language/definition', pergunta),
  typeDefinition: (pergunta: PerguntaDeCodigo) =>
    request<{ alvos: Alvo[] }>('POST', '/api/language/type-definition', pergunta),
  references: (pergunta: PerguntaDeCodigo) =>
    request<{ alvos: Alvo[] }>('POST', '/api/language/references', pergunta),

  // ---- espaço de trabalho (spec 012) ----
  browseFolders: (caminho?: string) =>
    request<ListagemDePastas>(
      'GET',
      caminho === undefined ? '/api/folders' : `/api/folders?path=${encodeURIComponent(caminho)}`
    ),
  workspace: () => request<RetratoDoEspaco>('GET', '/api/workspace'),
  /** Os filhos de uma pasta do projeto — a árvore carrega um nível por vez. */
  fileChildren: (caminho: string) =>
    request<{ nodes: FileNode[]; truncated: boolean }>(
      'GET',
      `/api/files/children?path=${encodeURIComponent(caminho)}`
    ),
  docs: () => request<{ path: string }>('GET', '/api/docs'),
  openFolder: (path: string) => request<RetratoDoEspaco>('POST', '/api/workspace', { path }),
  closeFolder: () => request<RetratoDoEspaco>('DELETE', '/api/workspace'),
  forgetFolder: (path: string) =>
    request<RetratoDoEspaco>('DELETE', '/api/workspace/recent', { path }),
  createWorkspaceFile: (name: string, content: string) =>
    request<{ path: string }>('POST', '/api/workspace/file', { name, content }),
  createWorkspaceFolder: (name: string) =>
    request<{ path: string }>('POST', '/api/workspace/folder', { name }),

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
  /** Uma linha sobre o servidor, para a árvore mostrar ao lado do nome. */
  describe: (id: string) => request<string | null>('GET', `${conexoes}/${id}/describe`),

  // ------------------------------------------------------------- arquivo remoto
  // (spec 053). O caminho vai sempre na URL codificado: nome de arquivo aceita
  // `?`, `&` e `#`, e qualquer um deles cortaria a consulta ao meio.
  lerArquivoRemoto: (id: string, caminho: string) =>
    request<{ path: string; content: string; bytes: number }>(
      'GET',
      `${conexoes}/${id}/files?path=${encodeURIComponent(caminho)}`
    ),
  encaminhamentos: (id: string) =>
    request<readonly PortForward[]>('GET', `${conexoes}/${id}/forwards`),
  abrirEncaminhamento: (
    id: string,
    dados: { remoteHost: string; remotePort: number; localPort?: number }
  ) => request<PortForward>('POST', `${conexoes}/${id}/forwards`, dados),
  fecharEncaminhamento: (id: string, forwardId: string) =>
    request<{ id: string }>('DELETE', `${conexoes}/${id}/forwards/${encodeURIComponent(forwardId)}`),
  snippetsDoTerminal: (id: string) =>
    request<readonly SnippetDeTerminal[]>('GET', `${conexoes}/${id}/snippets`),
  guardarSnippetDeTerminal: (id: string, snippet: { id?: string; nome: string; comando: string }) =>
    request<readonly SnippetDeTerminal[]>('POST', `${conexoes}/${id}/snippets`, snippet),
  apagarSnippetDeTerminal: (id: string, snippetId: string) =>
    request<readonly SnippetDeTerminal[]>(
      'DELETE',
      `${conexoes}/${id}/snippets/${encodeURIComponent(snippetId)}`
    ),
  metricasDoServidor: (id: string) =>
    request<HostMetrics>('GET', `${conexoes}/${id}/metrics`),
  /**
   * Sobe um arquivo em bytes (spec 060).
   *
   * Não passa pelo `request` genérico: aquele manda e espera JSON, e aqui o
   * corpo é binário cru.
   */
  enviarArquivoRemoto: async (
    id: string,
    caminho: string,
    dados: ArrayBuffer,
    criarPastas = true
  ): Promise<void> => {
    const url =
      `${conexoes}/${id}/files/upload?path=${encodeURIComponent(caminho)}` +
      `${criarPastas ? '&mkdir=1' : ''}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: dados,
    });
    const payload = (await r.json()) as { success: boolean; error: string | null };
    if (!payload.success) throw new Error(payload.error ?? 'Falha ao enviar.');
  },
  listarRemoto: (id: string, caminho: string) =>
    request<readonly RemoteEntry[]>(
      'GET',
      `${conexoes}/${id}/files/list?path=${encodeURIComponent(caminho)}`
    ),
  gravarArquivoRemoto: (id: string, caminho: string, conteudo: string) =>
    request<{ path: string; bytes: number }>('POST', `${conexoes}/${id}/files`, {
      path: caminho,
      content: conteudo,
    }),
  criarPastaRemota: (id: string, caminho: string) =>
    request<{ path: string }>('POST', `${conexoes}/${id}/files/mkdir`, { path: caminho }),
  renomearRemoto: (id: string, de: string, para: string) =>
    request<{ from: string; to: string }>('POST', `${conexoes}/${id}/files/rename`, {
      from: de,
      to: para,
    }),
  apagarRemoto: (id: string, caminho: string) =>
    request<{ path: string }>(
      'DELETE',
      `${conexoes}/${id}/files?path=${encodeURIComponent(caminho)}`
    ),
  favoritosRemotos: (id: string) =>
    request<readonly string[]>('GET', `${conexoes}/${id}/files/favorites`),
  alternarFavoritoRemoto: (id: string, caminho: string) =>
    request<readonly string[]>('POST', `${conexoes}/${id}/files/favorites`, { path: caminho }),
  executarScriptRemoto: (id: string, caminho: string) =>
    request<{ stdout: string; stderr: string; code: number | null }>(
      'POST',
      `${conexoes}/${id}/files/execute`,
      { path: caminho }
    ),
  children: (id: string, nodePath: readonly string[], filtro?: string | null) => {
    const base = comCaminho(`${conexoes}/${id}/children`, nodePath);
    const url = filtro === null || filtro === undefined || filtro === ''
      ? base
      : `${base}${base.includes('?') ? '&' : '?'}filter=${encodeURIComponent(filtro)}`;
    return request<TreeNode[]>('GET', url);
  },
  execute: (id: string, payload: ExecuteRequest) =>
    request<QueryResult>('POST', `${conexoes}/${id}/execute`, payload),
  readTable: (id: string, payload: TableRequest) =>
    request<TablePage>('POST', `${conexoes}/${id}/table`, payload),
  /** Varre a tabela inteira para exportar (T058). Filtros e ordem vão junto. */
  exportTable: (
    id: string,
    payload: {
      readonly nodePath: readonly string[];
      readonly ordenar: OrdenacaoDeTabela | null;
      readonly filtros: readonly FiltroDeTabela[];
    }
  ) =>
    request<{
      readonly columns: readonly ColumnInfo[];
      readonly rows: readonly (readonly CellValue[])[];
      readonly truncado: boolean;
    }>('POST', `${conexoes}/${id}/table/export`, payload),
  /** Interrompe a consulta em andamento naquela conexão (T005). */
  cancelQuery: (id: string) =>
    request<{ cancelado: boolean }>('POST', `${conexoes}/${id}/cancel`),
  /** O valor inteiro de uma célula, sem o corte da grade (spec 062). */
  readCell: (id: string, payload: CellRequest) =>
    request<CellResult>('POST', `${conexoes}/${id}/table/cell`, payload),
  tableStructure: (id: string, nodePath: readonly string[]) =>
    request<TableStructure>('GET', comCaminho(`${conexoes}/${id}/structure`, nodePath)),
  processList: (id: string) =>
    request<ProcessoDoBanco[] | null>('GET', `${conexoes}/${id}/processes`),
  killProcess: (id: string, pid: string) =>
    request<{ morto: string }>('POST', `${conexoes}/${id}/processes/${encodeURIComponent(pid)}/kill`),
  alterStructure: (id: string, payload: AlterRequest) =>
    request<AlterResult>('POST', `${conexoes}/${id}/alter`, payload),
  alterCapabilities: (id: string) =>
    request<AlterCapabilities>('GET', `${conexoes}/${id}/alter/capabilities`),
  writeTable: (id: string, payload: TableWriteRequest) =>
    request<TableWriteResult>('POST', `${conexoes}/${id}/table/write`, payload),
  runAction: (id: string, payload: ActionRequest) =>
    request<ActionResult>('POST', `${conexoes}/${id}/action`, payload),

  // ---- Arquivos de query (spec 038) ----
  //
  // Abrir e salvar NÃO estão aqui: passam por `readFile`/`saveFile`, para o
  // arquivo de query ser um arquivo como qualquer outro no editor. Estas rotas
  // fazem só o que aquelas não fazem.
  listQueries: (v: Vinculo) =>
    request<ArquivoDeQuery[]>(
      'GET',
      `/api/queries?connectionId=${encodeURIComponent(v.connectionId)}` +
        `&database=${encodeURIComponent(v.database)}`
    ),
  openQuery: (v: Vinculo, nome?: string) =>
    request<{ caminho: string }>('POST', '/api/queries/open', { ...v, nome }),
  createQuery: (v: Vinculo, nome: string) =>
    request<{ caminho: string }>('POST', '/api/queries', { ...v, nome }),
  renameQuery: (v: Vinculo, de: string, para: string) =>
    request<{ caminho: string }>('POST', '/api/queries/rename', { ...v, de, para }),
  deleteQuery: (v: Vinculo, nome: string) =>
    request<{ caminho: string }>('DELETE', '/api/queries', { ...v, nome }),

  listLinks: () =>
    request<{ raiz: string; links: Record<string, Vinculo> }>('GET', '/api/queries/links'),
  rememberLink: (caminho: string, v: Vinculo) =>
    request<{ caminho: string }>('POST', '/api/queries/links', { caminho, ...v }),
  forgetLink: (caminho: string) =>
    request<{ caminho: string }>('DELETE', '/api/queries/links', { caminho }),
};
