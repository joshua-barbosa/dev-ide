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
  /**
   * As opções.
   *
   * Em `select` é **lista fechada** — o servidor recusa o que não estiver aqui.
   * Em qualquer outro tipo são **sugestões**: a tela oferece, e o usuário pode
   * digitar outra coisa.
   *
   * A distinção nasceu do caminho da chave SSH (spec 052, D22): faz sentido
   * oferecer o que existe em `~/.ssh`, e não faz sentido proibir uma chave que
   * mora noutro lugar.
   */
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
  /**
   * Só existe quando outro campo tem um dos valores dados (spec 052, D20).
   *
   * O SSH pediu isto: `Auth` tem cinco valores, e cada um muda quais campos
   * fazem sentido — `Passphrase` só com chave, `Agent Path` só com agente.
   *
   * É **dado**, e não função, porque atravessa a API como JSON. E mora no
   * driver pela mesma razão da `section`: quem sabe que passphrase pertence à
   * chave é quem declarou os dois, não a tela.
   *
   * O valor é comparado como TEXTO — um `boolean` marcado vira `'true'` —,
   * porque é o único formato em que a condição sobrevive à ida e à volta.
   */
  readonly showIf?: {
    readonly campo: string;
    readonly valores: readonly string[];
  };
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
  /**
   * Quantas linhas PULAR antes de começar a devolver (T056).
   *
   * O SQL do usuário NÃO é reescrito: envolvê-lo num `SELECT * FROM (…)`
   * quebraria em consulta com colunas homônimas (`select a.id, b.id`), que é
   * erro de tabela derivada nos três dialetos. Aqui os drivers simplesmente
   * descartam as primeiras `offset` linhas do fluxo que já leem.
   *
   * O preço é honesto e explícito: o banco calcula as linhas puladas. Paginar
   * um `SELECT` arbitrário sem isso exigiria mentir sobre o total.
   */
  readonly offset?: number;
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

// ---------------------------------------------------------------------------
// A estrutura de uma tabela (spec 045)
// ---------------------------------------------------------------------------

export interface ColunaDetalhada {
  readonly name: string;
  readonly type: string;
  /** Tamanho declarado, quando o tipo tem um: `varchar(255)` dá 255. */
  readonly tamanho: number | null;
  readonly comentario: string | null;
  readonly padrao: string | null;
  readonly obrigatoria: boolean;
  readonly chave: boolean;
  readonly unica: boolean;
  readonly autoIncremento: boolean;
}

export interface ChaveEstrangeira {
  readonly nome: string;
  readonly coluna: string;
  readonly tabelaReferenciada: string;
  readonly colunaReferenciada: string;
  readonly aoAtualizar: string | null;
  readonly aoApagar: string | null;
}

export interface IndiceDaTabela {
  readonly nome: string;
  readonly colunas: readonly string[];
  readonly unico: boolean;
  readonly tipo: string | null;
}

export interface GatilhoDaTabela {
  readonly nome: string;
  /** `BEFORE` ou `AFTER`. */
  readonly momento: string;
  /** `INSERT`, `UPDATE` ou `DELETE`. */
  readonly evento: string;
  readonly orientacao: string | null;
  readonly corpo: string;
}

export interface ChecagemDaTabela {
  readonly nome: string;
  readonly expressao: string;
}

/**
 * Uma lista que o banco **não sabe** responder.
 *
 * Diferente de lista vazia: "este banco não tem chave estrangeira ligada" não é
 * a mesma coisa que "esta tabela não tem nenhuma", e mostrar as duas igual seria
 * o mesmo erro do total estimado da spec 041.
 */
export type ListaOuNaoSei<T> = { readonly itens: readonly T[] } | { readonly naoSei: string };

export interface TableStructure {
  readonly nome: string;
  readonly comentario: string | null;
  readonly motor: string | null;
  readonly colacao: string | null;
  /** `true` quando o objeto é uma view: a tela esconde o que não se aplica. */
  readonly ehView: boolean;
  readonly ddl: string;
  readonly colunas: readonly ColunaDetalhada[];
  readonly chavesEstrangeiras: ListaOuNaoSei<ChaveEstrangeira>;
  readonly indices: ListaOuNaoSei<IndiceDaTabela>;
  readonly gatilhos: ListaOuNaoSei<GatilhoDaTabela>;
  readonly checagens: ListaOuNaoSei<ChecagemDaTabela>;
}

// ---------------------------------------------------------------------------
// A lista de processos (spec 047)
// ---------------------------------------------------------------------------

export interface ProcessoDoBanco {
  readonly id: string;
  readonly usuario: string | null;
  readonly banco: string | null;
  readonly comando: string | null;
  readonly estado: string | null;
  /** Há quanto tempo está assim, em segundos. */
  readonly segundos: number | null;
  readonly sql: string | null;
  /** É a conexão da própria IDE — matá-la derrubaria a sessão. */
  readonly euMesmo: boolean;
}

/**
 * Pedir o comando de uma alteração de estrutura (spec 046).
 *
 * A resposta é o SQL como TEXTO: a IDE gera e abre; quem roda é o usuário.
 */
export interface AlterRequest {
  readonly nodePath: readonly string[];
  readonly operacao: Readonly<Record<string, unknown>>;
}

export interface AlterResult {
  readonly sql: string;
  readonly titulo: string;
}

/** O que ESTE banco sabe alterar. O que não vier aqui não vira botão. */
export interface AlterCapabilities {
  readonly dialeto: string;
  readonly operacoes: readonly string[];
}

/** Escrever pela grade (spec 044). Valores vão parametrizados, sempre. */
/**
 * Pedido do valor INTEIRO de uma célula (spec 062, fase D).
 *
 * A grade corta em `MAX_CELL_CHARS` porque uma página de 500 linhas com JSON de
 * 40 KB em cada uma seriam 20 MB atravessando a rede para caber em colunas de
 * 400 px. O visor pede de novo, uma célula por vez, e aí sem corte.
 */
export interface CellRequest {
  readonly nodePath: readonly string[];
  /** A linha, pela chave primária — a mesma que o `UPDATE` usa. */
  readonly chave: Readonly<Record<string, CellValue>>;
  readonly coluna: string;
}

export interface CellResult {
  readonly valor: CellValue;
  /**
   * Cortado mesmo assim, e em quantos caracteres.
   *
   * Existe um teto aqui também: um `blob` de 500 MB mataria a aba do navegador,
   * e "a IDE travou" é pior resposta que "este valor tem 500 MB".
   */
  readonly cortadoEm: number | null;
}

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
/**
 * Uma entrada de diretório remoto, como a tela a vê (spec 055).
 *
 * O servidor tem a sua em `connections/types.ts`, com os campos que só ele usa.
 * Esta é a parte que atravessa a API — e ela mora aqui porque a tabela SFTP e a
 * árvore lateral precisam do mesmo tipo.
 */
export interface RemoteEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: 'file' | 'folder' | 'link';
  readonly size: number | null;
  readonly modifiedAt: number | null;
  readonly owner?: string;
  readonly mode?: string;
  readonly executable?: boolean;
}

/**
 * A saúde de um servidor remoto (spec 056).
 *
 * Cada campo pode ser `null`, e isso é informação: um contêiner mínimo não tem
 * `/proc/net/dev`, e a PRIMEIRA amostra não tem CPU — porcentagem exige duas
 * leituras. `null` diz "não sei"; zero diria "está parado".
 */
export interface HostMetrics {
  readonly cpu: {
    readonly total: number;
    readonly usuario: number;
    readonly sistema: number;
    readonly espera: number;
  } | null;
  readonly memoria: {
    readonly totalBytes: number;
    readonly usadoBytes: number;
    readonly porcentagem: number;
  } | null;
  readonly disco: {
    readonly totalBytes: number;
    readonly usadoBytes: number;
    readonly livreBytes: number;
    readonly porcentagem: number;
  } | null;
  readonly uptimeSegundos: number | null;
  readonly carga: readonly number[] | null;
  readonly processos: readonly {
    readonly pid: number;
    readonly usuario: string;
    readonly cpu: number;
    readonly memoria: number;
    readonly rssBytes: number;
    readonly comando: string;
  }[];
  readonly rede: { readonly recebidoBytes: number; readonly enviadoBytes: number } | null;
}

/** Um encaminhamento de porta aberto (spec 059). */
export interface PortForward {
  readonly id: string;
  readonly localPort: number;
  readonly remoteHost: string;
  readonly remotePort: number;
}

export interface SessionCapabilities {
  readonly kind: ConnectionKind;
  readonly execute: boolean;
  readonly files: boolean;
  readonly shell: boolean;
  readonly monitor: boolean;
  readonly forwarding: boolean;
  /** Onde a navegação de arquivos começa. `/` quando a sessão não diz. */
  readonly rootPath: string;
  /** O que digitar no terminal quando o prompt aparecer (spec 061). */
  readonly comandoDeTerminal: string;
  /**
   * Sabe interromper uma consulta em andamento (T005)?
   *
   * `false` no SQLite: `node:sqlite` é síncrono, e enquanto a consulta roda o
   * processo inteiro está parado nela — não há segundo instante para mandar um
   * `KILL`. A interface não desenha o botão onde isto é `false`.
   */
  readonly cancelaQuery: boolean;
  /** Sabe desenhar o diagrama ER de um schema (T064). */
  readonly diagramaEr: boolean;
}

export interface ConnectionsState {
  readonly vault: VaultState;
  readonly tree: GroupNode;
  readonly openIds: readonly string[];
}
