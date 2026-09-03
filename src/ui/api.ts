import type { Tarefa } from '../shared/tarefas';
import type { Capacidade, ModoDeFormatacao } from '../shared/formatacao';
import type { EstadoDaFerramenta } from '../shared/ferramentas';
import type { LinhaDeLog, MetricaDoBanco, RetratoDaEstrutura } from '../shared/sql/manager';
import type { VersaoComTexto, VersaoLocal } from '../shared/historico-local';

/** Um erro ou aviso do serviço de linguagem (T037). */
export interface Diagnostico {
  readonly linha: number;
  readonly coluna: number;
  readonly linhaFim: number;
  readonly colunaFim: number;
  readonly severidade: 'erro' | 'aviso' | 'nota';
  readonly mensagem: string;
  readonly codigo: number;
}

/** Um lugar que seria trocado ao renomear (T038). */
export interface TrocaDeNome {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  readonly previa: string;
}

/** Uma sugestão de completar vinda do serviço (T114). */
export interface SugestaoDeCodigo {
  readonly texto: string;
  readonly tipo: string;
  readonly detalhe?: string;
}
import type { ConfiguracaoDoEmmet } from '../shared/emmet';
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
  FieldValue,
  VaultState,
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
import type { FiltroDaArvore } from '../shared/tree/filtro-da-arvore';
import type { DiagramaER } from '../shared/sql/diagrama-er';
import type { Codebase } from '../shared/sql/codebase';

/**
 * O filtro da árvore como ele viaja: o nome já traduzido para padrão de `LIKE`
 * e o tamanho já em bytes.
 *
 * Interpretar "10 MB" é lógica pura e mora no `shared`, testada. O que
 * atravessa a rede é o resultado, não o texto — assim o servidor não precisa
 * repetir a interpretação, e não há duas versões dela para divergirem.
 */
export interface CriteriosDeArvore {
  readonly filtro?: string | null;
  readonly dono?: string | null;
  readonly minBytes?: number | null;
  readonly desde?: string | null;
}
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
  /** As do `.vscode/tasks.json` da pasta aberta (T015). */
  readonly tarefas: readonly Tarefa[];
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

/** Uma raiz do espaço de trabalho, com a árvore dela (T004). */
export interface RaizAberta {
  readonly pasta: string;
  readonly nome: string;
  readonly arvore: readonly FileNode[];
  readonly truncated: boolean;
}

/** Tudo que a interface precisa para desenhar o espaço de trabalho, de uma vez. */
export interface RetratoDoEspaco {
  /** As raízes abertas, na ordem (T004). */
  readonly raizes: readonly RaizAberta[];
  /** A PRIMEIRA raiz — para quem só sabe lidar com uma. */
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
  /**
   * Um arquivo LOCAL em bytes, pela rota que a imagem e o PDF já usam (T090).
   *
   * Serve para arrastar um arquivo da árvore da IDE até o SFTP: em texto, um
   * `.png` chegaria corrompido ao servidor.
   */
  /** Os arquivos de uma pasta local, para subi-la ao servidor (T090). */
  arquivosDaPasta: (path: string) =>
    request<{
      files: { path: string; relative: string; bytes: number }[];
      ignored: number;
      truncated: boolean;
    }>('GET', `/api/workspace/folder-files?path=${encodeURIComponent(path)}`),
  lerBytesLocais: async (path: string): Promise<Uint8Array> => {
    const r = await fetch(`/api/file/raw?path=${encodeURIComponent(path)}`);
    if (!r.ok || (r.headers.get('Content-Type') ?? '').includes('application/json')) {
      const payload = (await r.json()) as { error: string | null };
      throw new Error(payload.error ?? `Falha ao ler "${path}".`);
    }
    return new Uint8Array(await r.arrayBuffer());
  },
  // Histórico local: o Timeline e o rascunho (T010, T035).
  historico: (path: string) =>
    request<readonly VersaoLocal[]>('GET', `/api/history?path=${encodeURIComponent(path)}`),
  versaoDoHistorico: (path: string, id: string) =>
    request<VersaoComTexto>(
      'GET',
      `/api/history/version?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`
    ),
  rascunhosPendentes: () =>
    request<readonly { path: string; caminho: string; quando: number }[]>(
      'GET',
      '/api/history/drafts'
    ),
  descartarRascunho: (path: string) =>
    request<{ path: string }>('DELETE', '/api/history/draft', { path }),
  saveFile: (path: string, content: string) =>
    request<{ path: string; bytes: number }>('POST', '/api/file', { path, content }),
  run: (payload: Record<string, unknown>) => request<RunResult>('POST', '/api/run', payload),
  stopRun: (id: string) =>
    request<{ parou: boolean }>('POST', `/api/run/${encodeURIComponent(id)}/stop`),

  // ---- comandos salvos (spec 018) ----
  commands: () => request<ListaDeComandos>('GET', '/api/commands'),
  /** O plano de execução de uma tarefa do `tasks.json` (T015). */
  taskPlan: (nome: string) =>
    request<{ passos: Tarefa[][] }>(
      'GET',
      `/api/commands/tarefas/${encodeURIComponent(nome)}/plano`
    ),
  /** A tarefa padrão de um grupo — o que `Run Build Task` roda (T016). */
  defaultTask: (grupo: 'build' | 'test') =>
    request<{ tarefa: Tarefa | null }>('GET', `/api/commands/tarefas/padrao/${grupo}`),
  createCommand: (nome: string, comando: string, destino: DestinoDeComando) =>
    request<ComandoSalvo>('POST', '/api/commands', { nome, comando, destino }),
  deleteCommand: (id: string) =>
    request<{ removido: boolean }>('DELETE', `/api/commands/${encodeURIComponent(id)}`),

  // ---- snippets (spec 019) ----
  snippets: () => request<Snippet[]>('GET', '/api/snippets'),
  createSnippet: (dados: Omit<Snippet, 'id'>) =>
    request<Snippet>('POST', '/api/snippets', dados),
  /** Importa snippets do VS Code de um arquivo ou pasta (T017). */
  importSnippets: (path: string) =>
    request<{ importados: number; repetidos: number }>('POST', '/api/snippets/import', { path }),
  deleteSnippet: (id: string) =>
    request<{ removido: boolean }>('DELETE', `/api/snippets/${encodeURIComponent(id)}`),

  // ---- busca em arquivos (spec 027) ----
  /** `filtros` são os padrões `include`/`exclude`, por vírgula (T031). */
  search: (
    termo: string,
    opcoes: OpcoesDeBusca,
    filtros: { readonly incluir: string; readonly excluir: string } = { incluir: '', excluir: '' }
  ) => request<ResultadoDaBusca>('POST', '/api/search', { termo, ...opcoes, ...filtros }),
  /** Desfaz uma substituição pelo id que ela devolveu (T032). */
  undoReplace: (id: string) =>
    request<{
      readonly restaurados: number;
      readonly pulados: number;
      readonly restauradosCaminhos: readonly string[];
      readonly termo: string;
      readonly substituto: string;
    }>('POST', '/api/search/undo', { id }),
  replaceInFiles: (
    termo: string,
    opcoes: OpcoesDeBusca,
    substituto: string,
    caminhos: readonly string[]
  ) =>
    request<{
      arquivosAlterados: number;
      trocas: number;
      /** O id para desfazer, ou `null` quando nada mudou (T032). */
      desfazer: string | null;
      descartadasDoHistorico: number;
    }>('POST', '/api/search/replace', {
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

  // ---- inteligência de código (lote E: T037, T038, T114) ----
  diagnosticos: (pergunta: PerguntaDeCodigo) =>
    request<{ problemas: readonly Diagnostico[] }>(
      'POST',
      '/api/language/diagnostics',
      pergunta
    ),
  lugaresParaRenomear: (pergunta: PerguntaDeCodigo) =>
    request<{ lugares: readonly TrocaDeNome[] }>(
      'POST',
      '/api/language/rename-locations',
      pergunta
    ),
  completar: (pergunta: PerguntaDeCodigo) =>
    request<{ sugestoes: readonly SugestaoDeCodigo[] }>(
      'POST',
      '/api/language/completions',
      pergunta
    ),

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
  /**
   * Todo arquivo das pastas abertas, para o `Ctrl+P` (T051, T004).
   *
   * `path` é absoluto e `label` é o que se lê — com mais de uma raiz, o rótulo
   * já vem prefixado pelo nome dela.
   */
  workspaceFiles: () =>
    request<{ files: { path: string; label: string }[]; truncated: boolean }>(
      'GET',
      '/api/workspace/files'
    ),
  /** Soma uma pasta ao espaço de trabalho, sem tirar as outras (T004). */
  addFolder: (path: string) => request<RetratoDoEspaco>('POST', '/api/workspace/add', { path }),
  /** Tira UMA raiz do espaço, deixando as demais (T004). */
  removeFolder: (path: string) =>
    request<RetratoDoEspaco>('DELETE', '/api/workspace/folder', { path }),
  openFolder: (path: string) => request<RetratoDoEspaco>('POST', '/api/workspace', { path }),
  closeFolder: () => request<RetratoDoEspaco>('DELETE', '/api/workspace'),
  forgetFolder: (path: string) =>
    request<RetratoDoEspaco>('DELETE', '/api/workspace/recent', { path }),
  createWorkspaceFile: (name: string, content: string) =>
    request<{ path: string }>('POST', '/api/workspace/file', { name, content }),
  createWorkspaceFolder: (name: string) =>
    request<{ path: string }>('POST', '/api/workspace/folder', { name }),
  /** Renomear, duplicar e excluir na árvore (T043). O caminho é absoluto. */
  renameEntry: (path: string, name: string) =>
    request<{ path: string }>('POST', '/api/workspace/rename', { path, name }),
  duplicateEntry: (path: string) =>
    request<{ path: string }>('POST', '/api/workspace/duplicate', { path }),
  deleteEntry: (path: string) =>
    request<{ path: string }>('DELETE', '/api/workspace/entry', { path }),

  // ---- preferências ----
  prefs: () => request<Preferencias>('GET', '/api/prefs'),
  setPrefs: (patch: PatchDePreferencias) =>
    request<Preferencias>('PATCH', '/api/prefs', patch),
  prefsPath: () => request<{ path: string }>('GET', '/api/prefs/file'),
  /** Cria o arquivo se preciso; devolve o caminho para abri-lo no editor. */
  /** Os temas declarados no `config.json` (T012). */
  prefsThemes: () =>
    request<Record<string, { base?: string; cores?: Record<string, unknown> }>>(
      'GET',
      '/api/prefs/themes'
    ),
  /** O que o projeto sobrescreve, e onde fica o arquivo dele (T002). */
  prefsProject: () =>
    request<{ path: string | null; sobrescritas: string[] }>('GET', '/api/prefs/project'),
  prefsProjectFile: () =>
    request<{ path: string }>('POST', '/api/prefs/project/file'),
  /** A configuração do Emmet (T022). */
  prefsEmmet: () => request<ConfiguracaoDoEmmet>('GET', '/api/prefs/emmet'),
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
  /**
   * Os bytes crus de um arquivo remoto (T089).
   *
   * Fora do `request` genérico, como o `enviarArquivoRemoto`: aquele espera
   * JSON, e aqui o corpo é binário. Embrulhá-lo em base64 custaria um terço a
   * mais de tráfego por arquivo, numa operação que baixa centenas deles.
   */
  lerBytesRemotos: async (id: string, caminho: string): Promise<Uint8Array> => {
    const r = await fetch(
      `${conexoes}/${id}/files/bytes?path=${encodeURIComponent(caminho)}`
    );
    // O erro continua em JSON; quem chama distingue pelo `Content-Type`.
    if (!r.ok || (r.headers.get('Content-Type') ?? '').includes('application/json')) {
      const payload = (await r.json()) as { error: string | null };
      throw new Error(payload.error ?? `Falha ao ler "${caminho}".`);
    }
    return new Uint8Array(await r.arrayBuffer());
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
  /** Troca as permissões de um arquivo remoto (T079). `modo` em octal: "755". */
  permissoesRemotas: (id: string, caminho: string, modo: string) =>
    request<{ path: string; mode: string }>('POST', `${conexoes}/${id}/files/chmod`, {
      path: caminho,
      mode: modo,
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
  children: (id: string, nodePath: readonly string[], criterios?: CriteriosDeArvore) => {
    const base = comCaminho(`${conexoes}/${id}/children`, nodePath);
    // Só entra na URL o que existe: um `filter=` vazio e um `filter` ausente
    // significariam a mesma coisa para o servidor, mas o histórico de rede fica
    // ilegível — e a spec 069 acrescentou mais três destes.
    const partes = Object.entries({
      filter: criterios?.filtro,
      owner: criterios?.dono,
      minBytes: criterios?.minBytes,
      since: criterios?.desde,
    })
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    const url = partes.length === 0
      ? base
      : `${base}${base.includes('?') ? '&' : '?'}${partes.join('&')}`;
    return request<TreeNode[]>('GET', url);
  },
  /** O catálogo do banco, para o autocomplete (T053). */
  codebase: (id: string, database: string) =>
    request<Codebase>(
      'GET',
      `${conexoes}/${id}/codebase?database=${encodeURIComponent(database)}`
    ),
  /** O diagrama ER de um schema (T064). */
  erDiagram: (id: string, nodePath: readonly string[]) =>
    request<DiagramaER>('GET', comCaminho(`${conexoes}/${id}/er`, nodePath)),
  /** Os filtros de árvore guardados desta conexão, por caminho (T111). */
  treeFilters: (id: string) =>
    request<Record<string, FiltroDaArvore>>('GET', `${conexoes}/${id}/tree-filters`),
  saveTreeFilter: (id: string, nodePath: readonly string[], filtro: FiltroDaArvore) =>
    request<Record<string, FiltroDaArvore>>('PUT', `${conexoes}/${id}/tree-filters`, {
      path: [...nodePath],
      filtro,
    }),
  execute: (id: string, payload: ExecuteRequest) =>
    request<QueryResult>('POST', `${conexoes}/${id}/execute`, payload),
  readTable: (id: string, payload: TableRequest) =>
    request<TablePage>('POST', `${conexoes}/${id}/table`, payload),
  /**
   * A senha guardada de UMA conexão, para o olho do formulário (N001).
   *
   * Um campo por chamada, de propósito: o cofre recusa campo que não é segredo,
   * e assim esta rota não vira um jeito torto de ler campo comum.
   */
  revelarSegredo: (id: string, campo: string) =>
    request<{ valor: string }>(
      'GET',
      `${conexoes}/${id}/secret/${encodeURIComponent(campo)}`
    ).then((r) => r.valor),
  /** O caminho do arquivo de snippets de terminal, para o `{}` (T085). */
  arquivoDeSnippetsDeTerminal: () =>
    request<{ path: string }>('GET', `${conexoes}/terminal-snippets/file`),
  /** Troca a senha mestra, recifrando todos os segredos (T100). */
  trocarSenhaMestra: (atual: string, nova: string, remember?: boolean) =>
    request<VaultState>('POST', `${conexoes}/vault/password`, { atual, nova, remember }),
  /** Abre e fecha a conexão do formulário, sem gravar nada no cofre (T103). */
  testarConexao: (input: {
    /** Da conexão que já existe: o servidor completa os segredos em branco. */
    readonly id?: string;
    readonly type: string;
    readonly label: string;
    readonly group: string;
    readonly readOnly: boolean;
    readonly fields: Readonly<Record<string, FieldValue>>;
  }) =>
    request<{ readonly conectou: boolean; readonly descricao: string | null }>(
      'POST',
      `${conexoes}/test`,
      input
    ),
  /** Todas as conexões COM as senhas, em JSON claro. Escolha dele (N001). */
  exportarConexoes: () =>
    request<{
      readonly exportadoEm: string;
      readonly aviso: string;
      readonly conexoes: readonly unknown[];
    }>('POST', `${conexoes}/export-all`),
  /** Importa conexões do arquivo exportado (N001). */
  importarConexoes: (lista: readonly unknown[], politica: string) =>
    request<{ readonly criadas: number; readonly substituidas: number; readonly puladas: number }>(
      'POST',
      `${conexoes}/import`,
      { conexoes: lista, politica }
    ),
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
  // A aba Manager (T070). Tudo leitura — o Structure Sync devolve TEXTO.
  /** `null` = este banco não é um servidor (SQLite). Diferente de lista vazia. */
  managerMetrics: (id: string) =>
    request<readonly MetricaDoBanco[] | null>('GET', `${conexoes}/${id}/manager/metrics`),
  managerLog: (id: string, limite = 200) =>
    request<readonly LinhaDeLog[] | null>(
      'GET',
      `${conexoes}/${id}/manager/log?limit=${limite}`
    ),
  managerStructure: (id: string, database: string) =>
    request<RetratoDaEstrutura>(
      'GET',
      `${conexoes}/${id}/manager/structure?database=${encodeURIComponent(database)}`
    ),
  killProcess: (id: string, pid: string) =>
    request<{ morto: string }>('POST', `${conexoes}/${id}/processes/${encodeURIComponent(pid)}/kill`),
  /**
   * Mata um processo DA MÁQUINA (T080).
   *
   * Nome e caminho distintos do `killProcess`, que é o do BANCO: são dois
   * conceitos diferentes, e uma conexão MySQL tem os dois.
   */
  killHostProcess: (id: string, pid: number, sinal: 'TERM' | 'KILL') =>
    request<{ pid: number; sinal: string }>(
      'POST',
      `${conexoes}/${id}/host/processes/${pid}/kill`,
      { sinal }
    ),
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

  // Beautify, Minify e o inventário do que a máquina tem (spec 077).
  formatCapabilities: () =>
    request<{
      capacidades: Record<string, Capacidade>;
      ferramentas: EstadoDaFerramenta[];
    }>('GET', '/api/format'),
  format: (p: {
    texto: string;
    linguagem: string;
    modo: ModoDeFormatacao;
    tabSize: number;
    dialeto?: string;
  }) => request<{ texto: string }>('POST', '/api/format', p),

  pasteEntry: (path: string, into: string, cut: boolean) =>
    request<{ path: string; movido: boolean }>('POST', '/api/workspace/paste', { path, into, cut }),
  revealEntry: (path: string) =>
    request<{ path: string }>('POST', '/api/workspace/reveal', { path }),

  listLinks: () =>
    request<{ raiz: string; links: Record<string, Vinculo> }>('GET', '/api/queries/links'),
  rememberLink: (caminho: string, v: Vinculo) =>
    request<{ caminho: string }>('POST', '/api/queries/links', { caminho, ...v }),
  forgetLink: (caminho: string) =>
    request<{ caminho: string }>('DELETE', '/api/queries/links', { caminho }),
};
