// Contratos que atravessam a fronteira HTTP.
//
// Ficam em `shared` porque servidor e interface precisam concordar sobre eles.
// Antes viviam só em connections/types.ts, mas a interface não compila `src/server`
// — e duplicar as formas dos dois lados é exatamente a divergência silenciosa que
// o resto do projeto evita.
//
// O que NÃO entra aqui: `Driver`, `Session` e o que só existe no servidor.

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

export type ConnectionKind = 'sql' | 'kv' | 'document' | 'files' | 'shell' | 'vector';

/** Painel da barra lateral em que o driver aparece. */
export type DriverPanel = 'database' | 'service';

// ---------------------------------------------------------------------------
// Campos de conexão
// ---------------------------------------------------------------------------

export type FieldValue = string | number | boolean;

export type FieldType =
  | 'string' | 'number' | 'boolean' | 'password' | 'path' | 'textarea' | 'select';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/** Descreve um campo do formulário; é o que torna a UI dirigida a dados. */
export interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required?: boolean;
  /** Vai cifrado para o cofre e nunca sai numa resposta. */
  readonly secret?: boolean;
  readonly default?: FieldValue;
  readonly placeholder?: string;
  readonly help?: string;
  readonly options?: readonly FieldOption[];
  /**
   * Seção do formulário. Ausente = a principal, que vem aberta; as demais vêm
   * recolhidas, na ordem em que aparecem aqui.
   *
   * Mora no driver, e não na interface, porque decidir o que é "principal" exige
   * saber o que o campo faz — conhecimento que só quem declara o campo tem. É a
   * mesma regra do ícone e do painel.
   */
  readonly section?: string;
}

export interface ConnectionInput {
  readonly type: string;
  readonly label: string;
  /** Caminho de grupo aninhado, ex.: "ACME/Bancos". Vazio = raiz. */
  readonly group: string;
  readonly readOnly: boolean;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

/** Conexão como a API devolve: sem segredos, só os nomes dos campos secretos. */
export interface PublicConnection {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly group: string;
  readonly readOnly: boolean;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly secretFields: readonly string[];
}

// ---------------------------------------------------------------------------
// Árvore
// ---------------------------------------------------------------------------

export interface NodeAction {
  readonly id: string;
  readonly label: string;
  /** Ação destrutiva: a UI confirma antes. */
  readonly danger?: boolean;
}

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** Texto secundário em cinza: "92", "8.0.40", "64.1G". */
  readonly detail?: string;
  readonly hasChildren: boolean;
  readonly actions?: readonly NodeAction[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Grupos são derivados dos caminhos, não persistidos como entidade. */
export interface GroupNode {
  readonly name: string;
  readonly path: string;
  readonly groups: readonly GroupNode[];
  readonly connections: readonly PublicConnection[];
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | null;

export interface ColumnInfo {
  readonly name: string;
  /** Tipo declarado, quando o driver souber: "varchar(64)", "int". */
  readonly type?: string;
}

export interface ExecuteRequest {
  readonly statement: string;
  /**
   * Contra qual database rodar (spec 038).
   *
   * Existe como campo próprio, e não como `nodePath` montado pela interface,
   * porque **quem sabe alcançar um database é o driver**: o PostgreSQL abre
   * outra conexão, o MySQL emite `USE`, e o SQLite não tem o conceito. Fazer a
   * UI montar o caminho seria pedir que ela soubesse as três coisas.
   */
  readonly database?: string;
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
// A aba de tabela (spec 041)
// ---------------------------------------------------------------------------

export interface OrdenacaoDeTabela {
  readonly coluna: string;
  readonly desc: boolean;
}

/** Semântica de "contém". Valor vazio é ignorado. */
export interface FiltroDeTabela {
  readonly coluna: string;
  readonly valor: string;
}

export interface TableRequest {
  readonly nodePath: readonly string[];
  readonly pagina: number;
  readonly porPagina: number;
  readonly ordenar?: OrdenacaoDeTabela | null;
  readonly filtros?: readonly FiltroDeTabela[];
}

/** Uma coluna como a aba de tabela precisa vê-la: com chave e obrigatoriedade. */
export interface TableColumn {
  readonly name: string;
  readonly type?: string;
  readonly chave: boolean;
  readonly obrigatoria: boolean;
}

export interface TablePage {
  readonly resultado: QueryResult;
  readonly columns: readonly TableColumn[];
  /**
   * Total de linhas que casam com o filtro.
   *
   * `null` quando contar seria caro demais — e aí `totalEstimado` diz o que se
   * sabe. Mostrar um número exato que não é seria pior que não mostrar.
   */
  readonly total: number | null;
  readonly totalEstimado: number | null;
  /** O SQL que rodou, para a aba mostrar no topo. */
  readonly sql: string;
}

/** Escrever pela grade (spec 044). Valores vão parametrizados, sempre. */
export interface TableWriteRequest {
  readonly nodePath: readonly string[];
  readonly insercoes?: readonly Readonly<Record<string, CellValue>>[];
  readonly alteracoes?: readonly {
    readonly chave: Readonly<Record<string, CellValue>>;
    readonly antes: Readonly<Record<string, CellValue>>;
    readonly depois: Readonly<Record<string, CellValue>>;
  }[];
  readonly remocoes?: readonly { readonly chave: Readonly<Record<string, CellValue>> }[];
  /**
   * Só monta o SQL, sem executar.
   *
   * A prévia e a gravação passam pelo MESMO código, com esta bandeira como
   * única diferença — montar duas vezes é como a prévia passa a mentir.
   */
  readonly simular?: boolean;
}

export interface TableWriteResult {
  /** O SQL exato, com os valores como `?` — é o que a confirmação mostra. */
  readonly comandos: readonly { readonly sql: string; readonly params: readonly CellValue[] }[];
  /** `false` quando foi só simulação. */
  readonly executado: boolean;
  readonly linhasAfetadas: number;
}

// ---------------------------------------------------------------------------
// Ações de menu
// ---------------------------------------------------------------------------

export interface ActionRequest {
  readonly nodePath: readonly string[];
  readonly actionId: string;
}

/** `statement` é SQL pronto para rodar; `text` é conteúdo para ler (DDL). */
export interface ActionResult {
  readonly kind: 'statement' | 'text';
  readonly title: string;
  readonly content: string;
  readonly language?: string;
}

// ---------------------------------------------------------------------------
// Estado e capacidades
// ---------------------------------------------------------------------------

export interface VaultState {
  readonly exists: boolean;
  readonly unlocked: boolean;
  /** Até quando o destrancamento está lembrado, em ISO. `null` quando não há. */
  readonly rememberedUntil: string | null;
  /** Falso quando a máquina não pode ser identificada: aí só a senha resolve. */
  readonly canRemember: boolean;
}

/** O que a rota de conectar devolve; a UI liga as abas conforme o que existir. */
export interface SessionCapabilities {
  readonly kind: ConnectionKind;
  readonly execute: boolean;
  readonly files: boolean;
  readonly shell: boolean;
  readonly monitor: boolean;
  readonly forwarding: boolean;
}

export interface ConnectionsState {
  readonly vault: VaultState;
  readonly tree: GroupNode;
  readonly openIds: readonly string[];
}
