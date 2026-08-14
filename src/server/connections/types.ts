// Contratos da camada de conexões.
//
// A ideia central: cada serviço (MySQL, Redis, SFTP, Pinecone...) implementa um
// `Driver`, e tudo que a UI conhece são tipos — o que permite um painel lateral
// e uma grade escritos UMA vez servirem a todos, e um driver novo entrar sem
// tocar na interface.
//
// As formas que ATRAVESSAM a fronteira HTTP moram em `shared/contracts.ts`,
// porque a interface também precisa delas e duplicá-las abriria espaço para
// divergência silenciosa. Aqui ficam apenas os tipos do lado do servidor —
// `Driver`, `Session` e suas capacidades — mais o reexporte dos compartilhados,
// para os drivers continuarem importando de um lugar só.
import type {
  ActionRequest,
  ActionResult,
  CellValue,
  ColumnInfo,
  ConnectionInput,
  ConnectionKind,
  DriverPanel,
  ExecuteRequest,
  FieldOption,
  FieldSpec,
  FieldType,
  FieldValue,
  NodeAction,
  PublicConnection,
  QueryResult,
  TreeNode,
} from '../../shared/contracts';
import type { NodeIcon } from '../../shared/icons';

export type {
  ActionRequest,
  ActionResult,
  CellValue,
  ColumnInfo,
  ConnectionInput,
  ConnectionKind,
  DriverPanel,
  ExecuteRequest,
  FieldOption,
  FieldSpec,
  FieldType,
  FieldValue,
  NodeAction,
  NodeIcon,
  PublicConnection,
  QueryResult,
  TreeNode,
};

// ---------------------------------------------------------------------------
// Configuração de conexão
// ---------------------------------------------------------------------------

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
