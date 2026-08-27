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
import type { TreeNode } from '../types';

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
  /** `relkind` do `pg_class`, quando a categoria sai de lá. */
  readonly kinds?: readonly string[];
  /** O objeto tem colunas para expandir. */
  readonly expande: boolean;
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

export const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', icon: 'table', kinds: ['r', 'p'], expande: true, acoes: ACOES_DE_TABELA },
  { id: 'views', label: 'Views', icon: 'view', kinds: ['v'], expande: true, acoes: ACOES_DE_VIEW },
  {
    id: 'matviews',
    label: 'Materialized Views',
    icon: 'matview',
    kinds: ['m'],
    expande: true,
    acoes: ACOES_DE_MATVIEW,
  },
  {
    id: 'foreign',
    label: 'Foreign Tables',
    icon: 'foreign',
    kinds: ['f'],
    expande: true,
    acoes: ACOES_DE_ESTRANGEIRA,
  },
  { id: 'functions', label: 'Functions', icon: 'function', expande: false },
  { id: 'sequences', label: 'Sequences', icon: 'sequence', kinds: ['S'], expande: false, acoes: ACOES_DE_SEQUENCIA },
  { id: 'types', label: 'Types', icon: 'type', expande: false },
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

async function listarFuncoes(
  client: Client,
  schema: string,
  filtro?: string | null
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('p.proname', 2, filtro);
  const { rows } = await client.query<{ nome: string; retorno: string }>(
    FUNCOES_SQL.replace('{FILTRO}', f.sql),
    [schema, ...f.params]
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
  filtro?: string | null
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('t.typname', 2, filtro);
  const { rows } = await client.query<{ nome: string; especie: string }>(
    TIPOS_SQL.replace('{FILTRO}', f.sql),
    [schema, ...f.params]
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
  filtro?: string | null
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('c.relname', 2, filtro);
  const { rows } = await client.query<{ nome: string; valor: string | null }>(
    SEQUENCIAS_SQL.replace('{FILTRO}', f.sql),
    [schema, ...f.params]
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
  filtro?: string | null
): Promise<TreeNode[]> {
  if (categoria === 'functions') return listarFuncoes(client, schema, filtro);
  if (categoria === 'types') return listarTipos(client, schema, filtro);
  if (categoria === 'sequences') return listarSequencias(client, schema, filtro);

  const alvo = CATEGORIAS.find((c) => c.id === categoria);
  if (alvo?.kinds === undefined) return [];

  const f = clausulaDeFiltro('c.relname', 3, filtro);
  const { rows } = await client.query<{ nome: string; linhas: string | null }>(
    TABELAS_SQL.replace('{FILTRO}', f.sql),
    [schema, alvo.kinds, ...f.params]
  );
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: alvo.icon,
    detail: linha.linhas === null ? undefined : contagem(linha.linhas),
    hasChildren: alvo.expande,
    // Spec 040: numa view não há o que inserir nem o que esvaziar (AC-7).
    actions: alvo.acoes,
    meta: { schema, object: linha.nome, category: categoria },
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
