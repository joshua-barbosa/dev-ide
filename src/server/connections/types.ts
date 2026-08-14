// Contratos da camada de conexões.
//
// A ideia central: cada serviço (MySQL, Redis, SFTP, Pinecone...) implementa um
// `Driver`, e tudo que a UI conhece são os tipos deste arquivo. Isso é o que
// permite um painel lateral e um grid escritos UMA vez servirem a todos, e um
// driver novo entrar sem tocar no frontend.

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

/** Família do serviço. Define o que a UI oferece por padrão para a conexão. */
export type ConnectionKind = 'sql' | 'kv' | 'document' | 'files' | 'shell' | 'vector';

/**
 * Painel da barra lateral em que o driver aparece.
 *
 * É declarado por driver, e não derivado de `kind`, porque a divisão é por
 * finalidade e não por protocolo: Redis (`kv`) e Pinecone (`vector`) são
 * armazenamento de dados e ficam em Database, enquanto SSH e FTP são
 * infraestrutura e ficam em Service.
 */
export type DriverPanel = 'database' | 'service';

/**
 * Ícone do nó. A lista vive em `shared/icons.ts`, que é também de onde a
 * interface tira o desenho — assim um ícone novo no contrato não compila
 * enquanto não tiver correspondente, em vez de sumir da tela em silêncio.
 */
import type { NodeIcon } from '../../shared/icons';
export type { NodeIcon };

// ---------------------------------------------------------------------------
// Configuração de conexão
// ---------------------------------------------------------------------------

export type FieldValue = string | number | boolean;

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'password'
  | 'path'
  | 'textarea'
  | 'select';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Descreve um campo do formulário de conexão. É o que torna a UI dirigida a
 * dados: o driver declara seus campos e o frontend renderiza o formulário
 * sozinho.
 */
export interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required?: boolean;
  /** Campo sensível: vai cifrado para o cofre e nunca sai numa resposta da API. */
  readonly secret?: boolean;
  readonly default?: FieldValue;
  readonly placeholder?: string;
  readonly help?: string;
  /** Valores aceitos quando `type` é 'select'. */
  readonly options?: readonly FieldOption[];
}

/** Conexão como o usuário a informa (ainda com os segredos em claro). */
export interface ConnectionInput {
  readonly type: string;
  readonly label: string;
  /** Caminho de grupo aninhado, ex.: "ACME/Bancos". Vazio = raiz. */
  readonly group: string;
  readonly readOnly: boolean;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

/**
 * Conexão como a API a devolve. Nunca contém segredos — apenas os NOMES dos
 * campos secretos preenchidos, para a UI conseguir mostrar "••••".
 */
export interface PublicConnection {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly group: string;
  readonly readOnly: boolean;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly secretFields: readonly string[];
}

/** Conexão com os segredos decifrados. Só existe do lado do servidor. */
export interface ResolvedConfig {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

// ---------------------------------------------------------------------------
// Árvore de navegação
// ---------------------------------------------------------------------------

export interface NodeAction {
  readonly id: string;
  readonly label: string;
  /** Ação destrutiva (DROP, TRUNCATE, rm): a UI confirma antes. */
  readonly danger?: boolean;
}

/**
 * Um nó da árvore lateral. Schema do MySQL, chave do Redis, pasta do SFTP e
 * índice do Pinecone viram todos isto.
 */
export interface TreeNode {
  /** Identificador opaco definido pelo driver; compõe o caminho do nó. */
  readonly id: string;
  readonly label: string;
  readonly icon: NodeIcon;
  /** Texto secundário em cinza: "92", "8.0.40", "64.1G". */
  readonly detail?: string;
  readonly hasChildren: boolean;
  readonly actions?: readonly NodeAction[];
  /** Contexto do driver (ex.: { schema, table }) para montar comandos. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Execução de comandos
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | null;

export interface ColumnInfo {
  readonly name: string;
  /** Tipo declarado, quando o driver souber: "varchar(64)", "int". */
  readonly type?: string;
}

export interface ExecuteRequest {
  readonly statement: string;
  /** Nó ativo, para o driver saber o schema/banco de contexto. */
  readonly nodePath?: readonly string[];
  readonly rowLimit?: number;
  readonly timeoutMs?: number;
}

export interface QueryResult {
  readonly columns: readonly ColumnInfo[];
  readonly rows: readonly (readonly CellValue[])[];
  readonly rowCount: number;
  readonly durationMs: number;
  /** true quando o limite de linhas cortou o resultado. */
  readonly truncated: boolean;
  /** Mensagem para comandos sem linhas: "3 linhas afetadas". */
  readonly message?: string;
}

// ---------------------------------------------------------------------------
// Ações de nó (menu de contexto)
// ---------------------------------------------------------------------------

export interface ActionRequest {
  readonly nodePath: readonly string[];
  readonly actionId: string;
}

/**
 * Resultado de uma ação do menu de contexto.
 *
 * As duas formas abrem uma aba de editor; a diferença é o que o usuário faz
 * com ela: `statement` é SQL pronto para rodar (o SELECT de uma tabela),
 * `text` é conteúdo para ler (o DDL de um objeto).
 */
export interface ActionResult {
  readonly kind: 'statement' | 'text';
  readonly title: string;
  readonly content: string;
  /** Linguagem para o highlight; por padrão, 'sql'. */
  readonly language?: string;
}

// ---------------------------------------------------------------------------
// Capacidades opcionais da sessão
// ---------------------------------------------------------------------------

export type RemoteEntryKind = 'file' | 'folder' | 'link';

/** Entrada de diretório remoto, com os metadados que a listagem SFTP mostra. */
export interface RemoteEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: RemoteEntryKind;
  readonly size: number | null;
  /** Epoch em milissegundos. */
  readonly modifiedAt: number | null;
  readonly owner?: string;
  /** Permissões em octal, ex.: "0644". */
  readonly mode?: string;
}

export interface RemoteFile {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
}

/**
 * Arquivos remotos (SFTP, FTP). Permite abrir um arquivo do servidor no editor
 * e salvar de volta direto nele.
 */
export interface RemoteFiles {
  list(remotePath: string): Promise<RemoteEntry[]>;
  read(remotePath: string): Promise<RemoteFile>;
  write(remotePath: string, content: string): Promise<void>;
  mkdir(remotePath: string): Promise<void>;
  remove(remotePath: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface ShellSize {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Canal de terminal interativo. O transporte é streaming (WebSocket), não REST —
 * um PTY não cabe em requisição/resposta.
 */
export interface ShellChannel {
  write(data: string): void;
  resize(size: ShellSize): void;
  onData(listener: (chunk: string) => void): void;
  onClose(listener: (code: number | null) => void): void;
  close(): void;
}

export interface RemoteShell {
  open(size: ShellSize): Promise<ShellChannel>;
}

/** Amostra de saúde do servidor, para a aba Monitor. */
export interface HostMetrics {
  readonly uptimeSeconds: number | null;
  readonly loadAverage: readonly number[] | null;
  readonly cpuPercent: number | null;
  readonly memoryTotalBytes: number | null;
  readonly memoryUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
  readonly diskUsedBytes: number | null;
}

export interface HostMonitor {
  sample(): Promise<HostMetrics>;
}

export interface PortForward {
  readonly id: string;
  readonly localPort: number;
  readonly remoteHost: string;
  readonly remotePort: number;
}

/** Encaminhamento de portas — também é o que habilita túnel SSH para os bancos. */
export interface PortForwarding {
  list(): Promise<PortForward[]>;
  open(remoteHost: string, remotePort: number, localPort?: number): Promise<PortForward>;
  close(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sessão e driver
// ---------------------------------------------------------------------------

/**
 * Conexão viva com um serviço. `children` é obrigatório (toda conexão navega);
 * o resto são capacidades opcionais — a UI habilita as abas conforme o que a
 * sessão expõe, então SSH mostra Monitor/Terminal/SFTP/Port Forwarding e MySQL
 * mostra apenas a árvore e o editor de query.
 */
export interface Session {
  readonly kind: ConnectionKind;
  /** Filhos do nó no caminho dado; `[]` de caminho vazio = raiz. Navegação lazy. */
  children(nodePath: readonly string[]): Promise<TreeNode[]>;
  readonly execute?: (request: ExecuteRequest) => Promise<QueryResult>;
  /** Executa uma das `actions` que o nó declarou (menu do botão direito). */
  readonly runAction?: (request: ActionRequest) => Promise<ActionResult>;
  readonly files?: RemoteFiles;
  readonly shell?: RemoteShell;
  readonly monitor?: HostMonitor;
  readonly forwarding?: PortForwarding;
  close(): Promise<void>;
}

export interface Driver {
  readonly type: string;
  readonly label: string;
  readonly kind: ConnectionKind;
  readonly panel: DriverPanel;
  readonly icon: NodeIcon;
  readonly defaultPort?: number;
  readonly fields: readonly FieldSpec[];
  connect(config: ResolvedConfig): Promise<Session>;
}
