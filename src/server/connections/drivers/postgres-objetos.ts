// As categorias da árvore do PostgreSQL e o que há dentro delas (spec 069).
//
// Saiu de `postgres.ts` quando o arquivo chegou a 796 linhas e esta spec ia
// somar mais — o teto de 800 do Artigo IV é o mesmo portão que já cortou
// `postgres-sql.ts` da spec 041.
//
// A mudança de comportamento aqui é uma só, e é de propósito: **`Views` não
// inclui mais view materializada**. Uma matview ocupa disco, tem índice e
// precisa de `REFRESH` — chamá-la de view fazia a contagem mentir sobre o que
// há no schema.
import type { Client } from 'pg';
import { TEMPLATES_POSTGRES } from '../../../shared/tree/templates';
import { ACOES_DE_TABELA, ACOES_DE_VIEW } from './modelos';
import {
  CONTAGENS_SQL,
  COLUNAS_SQL,
  FUNCOES_SQL,
  SEQUENCIAS_SQL,
  TABELAS_SQL,
  TIPOS_SQL,
} from './postgres-sql';
import type { OpcoesDeNavegacao, TreeNode } from '../types';
import type { Criterio } from '../../../shared/tree/filtro-da-arvore';

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
  /** `relkind` do `pg_class`, quando a categoria sai de lá. */
  readonly kinds?: readonly string[];
  /** O objeto tem colunas para expandir. */
  readonly expande: boolean;
  /**
   * Por que se pode filtrar AQUI (T112).
   *
   * O PostgreSQL não guarda data de criação de tabela — nenhuma categoria
   * declara `data`. Oferecer o campo e devolver tudo seria pior que não
   * oferecer.
   */
  readonly criterios: readonly Criterio[];
  readonly acoes?: readonly { id: string; label: string; danger?: boolean }[];
}

/** Ações de uma view materializada: `DROP VIEW` nela é recusado pelo banco. */
const ACOES_DE_MATVIEW: readonly { id: string; label: string; danger?: boolean }[] = [
  { id: 'select', label: 'Abrir Query' },
  { id: 'ddl', label: 'Ver DDL' },
  { id: 'count', label: 'Contar linhas (exato)' },
  { id: 'template-select', label: 'SELECT' },
  { id: 'refresh-matview', label: 'REFRESH' },
  { id: 'drop-matview', label: 'Apagar (DROP)', danger: true },
];

const ACOES_DE_ESTRANGEIRA: readonly { id: string; label: string; danger?: boolean }[] = [
  { id: 'select', label: 'Abrir Query' },
  { id: 'count', label: 'Contar linhas (exato)' },
  { id: 'template-select', label: 'SELECT' },
];

const ACOES_DE_SEQUENCIA: readonly { id: string; label: string; danger?: boolean }[] = [
  { id: 'select', label: 'Abrir Query' },
  { id: 'drop-sequence', label: 'Apagar (DROP)', danger: true },
];

/** O que TEM tamanho no disco; uma view é uma consulta guardada, e não ocupa. */
const COM_TAMANHO: readonly Criterio[] = ['nome', 'dono', 'tamanho'];
const SEM_TAMANHO: readonly Criterio[] = ['nome', 'dono'];

export const CATEGORIAS: readonly Categoria[] = [
  {
    id: 'tables', label: 'Tables', icon: 'table', kinds: ['r', 'p'],
    expande: true, acoes: ACOES_DE_TABELA, criterios: COM_TAMANHO,
  },
  {
    id: 'views', label: 'Views', icon: 'view', kinds: ['v'],
    expande: true, acoes: ACOES_DE_VIEW, criterios: SEM_TAMANHO,
  },
  {
    id: 'matviews', label: 'Materialized Views', icon: 'matview', kinds: ['m'],
    expande: true, acoes: ACOES_DE_MATVIEW, criterios: COM_TAMANHO,
  },
  {
    id: 'foreign', label: 'Foreign Tables', icon: 'foreign', kinds: ['f'],
    expande: true, acoes: ACOES_DE_ESTRANGEIRA, criterios: SEM_TAMANHO,
  },
  { id: 'functions', label: 'Functions', icon: 'function', expande: false, criterios: SEM_TAMANHO },
  {
    id: 'sequences', label: 'Sequences', icon: 'sequence', kinds: ['S'],
    expande: false, acoes: ACOES_DE_SEQUENCIA, criterios: SEM_TAMANHO,
  },
  { id: 'types', label: 'Types', icon: 'type', expande: false, criterios: SEM_TAMANHO },
];

/** A categoria expande em colunas? Quem responde é a tabela acima. */
export function expandeEmColunas(categoria: string | undefined): boolean {
  return CATEGORIAS.find((c) => c.id === categoria)?.expande === true;
}

function contagem(valor: unknown): string | undefined {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n) : undefined;
}

export async function listarCategorias(client: Client, schema: string): Promise<TreeNode[]> {
  const { rows } = await client.query<Record<string, unknown>>(CONTAGENS_SQL, [schema]);
  const contagens = rows[0] ?? {};
  return CATEGORIAS.map((categoria) => ({
    id: categoria.id,
    label: categoria.label,
    icon: categoria.icon,
    detail: contagem(contagens[categoria.id]),
    hasChildren: true,
    // `categoria: true` liga as ações na interface; o esqueleto já vem com o
    // schema aplicado, para o `CREATE` nascer no lugar certo.
    meta: {
      schema,
      categoria: true,
      criterios: categoria.criterios,
      template: TEMPLATES_POSTGRES[categoria.id]?.replaceAll('{schema}', schema),
    },
  }));
}

/**
 * Cláusula opcional de filtro, com o padrão LIGADO.
 *
 * Recebe a posição do parâmetro porque o PostgreSQL numera (`$1`, `$2`) — o
 * pedaço de SQL e o valor saem juntos, para não haver como pôr um sem o outro.
 */
export function clausulaDeFiltro(
  coluna: string,
  posicao: number,
  filtro?: string | null
): { sql: string; params: unknown[] } {
  return filtro === null || filtro === undefined
    ? { sql: '', params: [] }
    : { sql: ` AND ${coluna} LIKE $${posicao}`, params: [filtro] };
}

/** Uma condição a mais: a EXPRESSÃO de um lado, o valor do outro, ligado. */
interface Condicao {
  readonly expressao: string;
  readonly operador: string;
  readonly valor: unknown;
}

/**
 * Monta `AND …` para as condições que existirem, numerando os parâmetros a
 * partir de quantos já foram usados.
 *
 * A expressão vem do CÓDIGO (`pg_get_userbyid(c.relowner)`) e o valor vem do
 * usuário, sempre como `$n`. É a mesma separação de `clausulaDeFiltro`, agora
 * com mais de um critério — e é ela que faz um filtro por dono continuar sendo
 * um filtro, e não uma injeção.
 */
function condicoes(jaUsados: number, itens: readonly (Condicao | null)[]): {
  sql: string;
  params: unknown[];
} {
  const validos = itens.filter((c): c is Condicao => c !== null);
  const params = validos.map((c) => c.valor);
  const sql = validos
    .map((c, i) => ` AND ${c.expressao} ${c.operador} $${jaUsados + i + 1}`)
    .join('');
  return { sql, params };
}

/** As condições dos critérios da spec 069, na ordem em que os SQL as esperam. */
function criteriosDe(
  categoria: Categoria,
  opcoes: OpcoesDeNavegacao | undefined,
  colunaDoDono: string
): readonly (Condicao | null)[] {
  const podeDono = categoria.criterios.includes('dono');
  const podeTamanho = categoria.criterios.includes('tamanho');
  return [
    podeDono && opcoes?.dono !== null && opcoes?.dono !== undefined
      ? { expressao: colunaDoDono, operador: '=', valor: opcoes.dono }
      : null,
    podeTamanho && opcoes?.minBytes !== null && opcoes?.minBytes !== undefined
      ? { expressao: 'pg_total_relation_size(c.oid)', operador: '>=', valor: opcoes.minBytes }
      : null,
  ];
}

async function listarFuncoes(
  client: Client,
  schema: string,
  categoria: Categoria,
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('p.proname', 2, opcoes?.filtro);
  const c = condicoes(1 + f.params.length, criteriosDe(categoria, opcoes, 'pg_get_userbyid(p.proowner)'));
  const { rows } = await client.query<{ nome: string; retorno: string }>(
    FUNCOES_SQL.replace('{FILTRO}', f.sql + c.sql),
    [schema, ...f.params, ...c.params]
  );
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: 'function' as const,
    detail: linha.retorno,
    hasChildren: false,
    meta: { schema, object: linha.nome, category: 'functions' },
  }));
}

async function listarTipos(
  client: Client,
  schema: string,
  categoria: Categoria,
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('t.typname', 2, opcoes?.filtro);
  const c = condicoes(1 + f.params.length, criteriosDe(categoria, opcoes, 'pg_get_userbyid(t.typowner)'));
  const { rows } = await client.query<{ nome: string; especie: string }>(
    TIPOS_SQL.replace('{FILTRO}', f.sql + c.sql),
    [schema, ...f.params, ...c.params]
  );
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: 'type' as const,
    detail: linha.especie,
    hasChildren: false,
    meta: { schema, object: linha.nome, category: 'types' },
  }));
}

async function listarSequencias(
  client: Client,
  schema: string,
  categoria: Categoria,
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('c.relname', 2, opcoes?.filtro);
  const c = condicoes(1 + f.params.length, criteriosDe(categoria, opcoes, 'pg_get_userbyid(c.relowner)'));
  const { rows } = await client.query<{ nome: string; valor: string | null }>(
    SEQUENCIAS_SQL.replace('{FILTRO}', f.sql + c.sql),
    [schema, ...f.params, ...c.params]
  );
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: 'sequence' as const,
    // `pg_sequence_last_value` devolve NULL sem permissão de leitura — e nesse
    // caso não há detalhe, em vez de um zero que seria mentira.
    detail: linha.valor === null ? undefined : linha.valor,
    hasChildren: false,
    actions: ACOES_DE_SEQUENCIA,
    meta: { schema, object: linha.nome, category: 'sequences' },
  }));
}

export async function listarObjetos(
  client: Client,
  schema: string,
  categoria: string,
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  const alvo = CATEGORIAS.find((c) => c.id === categoria);
  if (alvo === undefined) return [];
  if (categoria === 'functions') return listarFuncoes(client, schema, alvo, opcoes);
  if (categoria === 'types') return listarTipos(client, schema, alvo, opcoes);
  if (categoria === 'sequences') return listarSequencias(client, schema, alvo, opcoes);
  if (alvo.kinds === undefined) return [];

  const f = clausulaDeFiltro('c.relname', 3, opcoes?.filtro);
  const c = condicoes(2 + f.params.length, criteriosDe(alvo, opcoes, 'pg_get_userbyid(c.relowner)'));
  const { rows } = await client.query<{ nome: string; linhas: string | null }>(
    TABELAS_SQL.replace('{FILTRO}', f.sql + c.sql),
    [schema, alvo.kinds, ...f.params, ...c.params]
  );
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: alvo.icon,
    detail: linha.linhas === null ? undefined : contagem(linha.linhas),
    hasChildren: alvo.expande,
    // Spec 040: numa view não há o que inserir nem o que esvaziar (AC-7).
    actions: alvo.acoes,
    meta: {
      schema, object: linha.nome, category: categoria,
      // O nó DECLARA que sabe virar diagrama (P4) — ver a nota no mysql.
      ...(categoria === 'tables' ? { diagramaDaTabela: true } : {}),
    },
  }));
}

export async function listarColunas(
  client: Client,
  schema: string,
  objeto: string
): Promise<TreeNode[]> {
  const { rows } = await client.query<{
    nome: string;
    tipo: string;
    obrigatorio: boolean;
    pk: boolean;
  }>(COLUNAS_SQL, [schema, objeto]);

  return rows.map((linha) => {
    const marcas = [linha.tipo];
    if (linha.pk) marcas.push('PK');
    if (linha.obrigatorio) marcas.push('NOT NULL');
    return {
      id: linha.nome,
      label: linha.nome,
      icon: 'column' as const,
      detail: marcas.join(' · '),
      hasChildren: false,
      meta: { schema, object: objeto, column: linha.nome },
    };
  });
}
