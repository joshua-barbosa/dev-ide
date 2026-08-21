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
  TablePage,
  TableRequest,
  TableWriteRequest,
  TableWriteResult,
  TreeNode,
  VaultState,
} from '../../shared/contracts';
export type {
  TableColumn,
  TablePage,
  TableRequest,
  TableWriteRequest,
  TableWriteResult,
} from '../../shared/contracts';
import type { NodeIcon } from '../../shared/icons';
import type { ClienteDeLinhaDeComando } from '../../shared/terminal/comando';

export type { ClienteDeLinhaDeComando };

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
  VaultState,
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
  children(nodePath: readonly string[], opcoes?: OpcoesDeNavegacao): Promise<TreeNode[]>;
  readonly execute?: (request: ExecuteRequest) => Promise<QueryResult>;
  /** Executa uma das `actions` que o nó declarou (menu do botão direito). */
  readonly runAction?: (request: ActionRequest) => Promise<ActionResult>;
  /**
   * Uma página de uma TABELA, com total real, ordenação e filtros (spec 041).
   *
   * Separado do `execute` de propósito: paginar e contar só são possíveis
   * sabendo a tabela. Envolver um `SELECT` qualquer num `COUNT(*)` daria número
   * errado — e em silêncio — quando ele tivesse `GROUP BY` ou `LIMIT` próprio.
   */
  readonly readTable?: (request: TableRequest) => Promise<TablePage>;
  /**
   * Escreve o rascunho da grade, em UMA transação (spec 044).
   *
   * Com `simular`, monta o SQL e não executa — é o que a confirmação mostra.
   * Um `UPDATE` ou `DELETE` que afete zero linhas desfaz tudo: significa que a
   * linha mudou por baixo entre a leitura e a gravação.
   */
  readonly writeTable?: (request: TableWriteRequest) => Promise<TableWriteResult>;
  readonly files?: RemoteFiles;
  readonly shell?: RemoteShell;
  readonly monitor?: HostMonitor;
  readonly forwarding?: PortForwarding;
  /**
   * Avisa que a conexão subjacente morreu por conta própria — o servidor de
   * banco encerrou por ociosidade, a rede caiu, o processo remoto foi morto.
   * O pool usa isto para despejar a sessão em vez de continuar entregando uma
   * conexão inútil. Um driver que não implementa fica preso à sessão morta.
   */
  readonly onClosed?: (listener: (motivo: string) => void) => void;
  close(): Promise<void>;
}

/** O que modula a listagem de filhos. */
export interface OpcoesDeNavegacao {
  /**
   * Padrão de `LIKE` já traduzido por `padraoDeFiltro`.
   *
   * Vai LIGADO na consulta, jamais concatenado: o valor vem do usuário, e é o
   * que separa um filtro de uma injeção.
   */
  readonly filtro?: string | null;
}

export interface Driver {
  readonly type: string;
  readonly label: string;
  readonly kind: ConnectionKind;
  readonly panel: DriverPanel;
  /**
   * Ícone da conexão. Aceita nome do contrato (`database`) ou qualificado
   * (`devicon:mysql`), porque a marca de cada serviço não cabe no conjunto
   * fechado de `NodeIcon` — que descreve tipos de OBJETO, não de produto.
   * Nome não empacotado cai no genérico; ver `resolverIcone`.
   */
  readonly icon: NodeIcon | string;
  readonly defaultPort?: number;
  readonly fields: readonly FieldSpec[];
  /**
   * Cliente de linha de comando, se houver. Ausente significa que a ação
   * "abrir no terminal" nem aparece — é o caso do SQLite.
   */
  readonly cli?: ClienteDeLinhaDeComando;
  connect(config: ResolvedConfig): Promise<Session>;
}
