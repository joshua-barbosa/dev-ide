// As categorias da árvore do MySQL e o que há dentro delas (spec 069).
//
// Saiu de `mysql.ts` quando ele passou do teto de 800 linhas do Artigo IV ao
// ganhar o diagrama ER. É o mesmo corte que o PostgreSQL já tinha feito em
// `postgres-objetos.ts`, e pelo mesmo motivo: aqui está o que responde "o que
// existe neste banco", e lá o que sabe abrir e fechar a conexão.
import type { Connection } from 'mysql2';
import { query } from './mysql-base';
import { CONTAGENS_SQL, COLUNAS_ARVORE_SQL } from './mysql-sql';
import { ACOES_DE_TABELA, ACOES_DE_VIEW } from './modelos';
import { TEMPLATES_MYSQL } from '../../../shared/tree/templates';
import { applyVisibility, mainFirst, type VisibilityOptions } from './sql-base';
import type { Criterio } from '../../../shared/tree/filtro-da-arvore';
import type { OpcoesDeNavegacao, TreeNode } from '../types';

export interface Exibicao {
  readonly main: string;
  readonly visibilidade: VisibilityOptions;
  readonly rowLimit: number;
}

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
  /**
   * Por que se pode filtrar AQUI (T112, spec 069).
   *
   * O MySQL não tem dono POR TABELA — quem tem dono é a rotina e o evento, pelo
   * `DEFINER`. E uma view não ocupa disco nem guarda data de escrita: declarar
   * `tamanho` nela devolveria a lista inteira, calado.
   */
  readonly criterios: readonly Criterio[];
}

const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', icon: 'table', criterios: ['nome', 'tamanho', 'data'] },
  { id: 'views', label: 'Views', icon: 'view', criterios: ['nome'] },
  { id: 'functions', label: 'Functions', icon: 'function', criterios: ['nome', 'dono'] },
  { id: 'procedures', label: 'Procedures', icon: 'procedure', criterios: ['nome', 'dono'] },
  // Spec 069 (T110). Sequence, type, foreign table e matview NÃO entram aqui:
  // o MySQL não tem nenhum dos quatro, e categoria sempre vazia é ruído.
  { id: 'events', label: 'Events', icon: 'event', criterios: ['nome', 'dono'] },
];


/** Formata bytes como "64.1G", igual ao que a árvore mostra ao lado do banco. */
export function tamanho(bytes: number | null): string | undefined {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const unidades = ['B', 'K', 'M', 'G', 'T'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return i === 0 ? `${valor}B` : `${valor.toFixed(1)}${unidades[i]}`;
}

export function contagem(valor: unknown): string | undefined {
  const n = Number(valor);
  return Number.isFinite(n) ? String(n) : undefined;
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

export async function listarBancos(conn: Connection, exibicao: Exibicao): Promise<TreeNode[]> {
  const linhas = await query<{ SCHEMA_NAME: string; bytes: string | number | null }>(
    conn,
    `SELECT s.SCHEMA_NAME,
            (SELECT SUM(t.DATA_LENGTH + t.INDEX_LENGTH)
               FROM information_schema.TABLES t
              WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME) AS bytes
       FROM information_schema.SCHEMATA s
      ORDER BY s.SCHEMA_NAME`
  );

  const visiveis = applyVisibility(linhas, (linha) => linha.SCHEMA_NAME, exibicao.visibilidade);
  const ordenados = mainFirst(visiveis, exibicao.main, (linha) => linha.SCHEMA_NAME);

  return ordenados.map((linha) => ({
    id: linha.SCHEMA_NAME,
    label: linha.SCHEMA_NAME,
    icon: 'database' as const,
    detail: tamanho(linha.bytes === null ? null : Number(linha.bytes)),
    hasChildren: true,
    meta: {
      schema: linha.SCHEMA_NAME,
      // `database` é o que diz à interface que este nó pode abrir uma query
      // (spec 038). Quem declara é o driver; quem decide que isso merece um
      // botão é a interface — Artigo III.
      database: linha.SCHEMA_NAME,
      // No MySQL schema e database são a mesma coisa: o diagrama é daqui (T064).
      diagramaEr: true,
      main: linha.SCHEMA_NAME.toLowerCase() === exibicao.main.trim().toLowerCase(),
    },
  }));
}


export async function listarCategorias(conn: Connection, schema: string): Promise<TreeNode[]> {
  const [contagens = {}] = await query<Record<string, unknown>>(conn, CONTAGENS_SQL, [
    schema,
    schema,
    schema,
    schema,
    schema,
  ]);
  return CATEGORIAS.map((categoria) => ({
    id: categoria.id,
    label: categoria.label,
    icon: categoria.icon,
    detail: contagem(contagens[categoria.id]),
    hasChildren: true,
    // `categoria: true` é o que liga as ações de recarregar/filtrar/criar na
    // interface, sem que ela precise saber quais nomes são categorias.
    meta: {
      schema,
      categoria: true,
      criterios: categoria.criterios,
      template: TEMPLATES_MYSQL[categoria.id],
    },
  }));
}

/**
 * Cláusula opcional de filtro, com o padrão LIGADO.
 *
 * Devolve o pedaço de SQL e o parâmetro juntos, para não haver como acrescentar
 * um sem o outro — que é o descuido que vira injeção.
 */
export function clausulaDeFiltro(coluna: string, filtro?: string | null): { sql: string; params: unknown[] } {
  return filtro === null || filtro === undefined
    ? { sql: '', params: [] }
    : { sql: ` AND ${coluna} LIKE ?`, params: [filtro] };
}

/**
 * As condições dos critérios da spec 069.
 *
 * A EXPRESSÃO vem do código e o valor vai ligado como `?`, sempre — a mesma
 * separação de `clausulaDeFiltro`, com mais de um critério.
 *
 * `COALESCE(UPDATE_TIME, CREATE_TIME)`: o InnoDB deixa `UPDATE_TIME` nulo em
 * tabela que ninguém escreveu desde o último restart. Sem o `COALESCE`, essas
 * tabelas sumiriam de qualquer filtro por data.
 */
export function condicoesDe(
  categoria: Categoria,
  opcoes: OpcoesDeNavegacao | undefined,
  colunaDoDono: string | null
): { sql: string; params: unknown[] } {
  const partes: string[] = [];
  const params: unknown[] = [];
  const pode = (c: Criterio): boolean => categoria.criterios.includes(c);

  if (pode('dono') && colunaDoDono !== null && opcoes?.dono !== null && opcoes?.dono !== undefined) {
    partes.push(` AND ${colunaDoDono} = ?`);
    params.push(opcoes.dono);
  }
  if (pode('tamanho') && opcoes?.minBytes !== null && opcoes?.minBytes !== undefined) {
    partes.push(' AND (COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) >= ?');
    params.push(opcoes.minBytes);
  }
  if (pode('data') && opcoes?.desde !== null && opcoes?.desde !== undefined) {
    partes.push(' AND COALESCE(UPDATE_TIME, CREATE_TIME) >= ?');
    params.push(opcoes.desde);
  }
  return { sql: partes.join(''), params };
}

export async function listarObjetos(
  conn: Connection,
  schema: string,
  categoria: string,
  opcoes?: OpcoesDeNavegacao
): Promise<TreeNode[]> {
  const alvo = CATEGORIAS.find((c) => c.id === categoria);
  if (alvo === undefined) return [];
  const filtro = opcoes?.filtro;

  if (categoria === 'tables' || categoria === 'views') {
    const tipo = categoria === 'tables' ? 'BASE TABLE' : 'VIEW';
    const f = clausulaDeFiltro('TABLE_NAME', filtro);
    const c = condicoesDe(alvo, opcoes, null);
    const linhas = await query<{ TABLE_NAME: string; TABLE_ROWS: number | null }>(
      conn,
      `SELECT TABLE_NAME, TABLE_ROWS
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?${f.sql}${c.sql}
        ORDER BY TABLE_NAME`,
      [schema, tipo, ...f.params, ...c.params]
    );
    return linhas.map((linha) => ({
      id: linha.TABLE_NAME,
      label: linha.TABLE_NAME,
      icon: (categoria === 'tables' ? 'table' : 'view') as TreeNode['icon'],
      // TABLE_ROWS é estimativa no InnoDB — suficiente para orientar, não para contar.
      detail: linha.TABLE_ROWS === null ? undefined : contagem(linha.TABLE_ROWS),
      hasChildren: true,
      // O menu de tabela e o de view são diferentes: numa view não há o que
      // inserir nem o que esvaziar (spec 040, AC-7).
      actions: categoria === 'tables' ? ACOES_DE_TABELA : ACOES_DE_VIEW,
      meta: { schema, object: linha.TABLE_NAME, category: categoria },
    }));
  }

  if (categoria === 'events') {
    const f = clausulaDeFiltro('EVENT_NAME', filtro);
    const c = condicoesDe(alvo, opcoes, "SUBSTRING_INDEX(DEFINER, '@', 1)");
    const linhas = await query<{ EVENT_NAME: string; STATUS: string; QUANDO: string | null }>(
      conn,
      `SELECT EVENT_NAME, STATUS,
              CASE WHEN EVENT_TYPE = 'RECURRING'
                   THEN CONCAT('a cada ', INTERVAL_VALUE, ' ', INTERVAL_FIELD)
                   ELSE CAST(EXECUTE_AT AS CHAR) END AS QUANDO
         FROM information_schema.EVENTS
        WHERE EVENT_SCHEMA = ?${f.sql}${c.sql}
        ORDER BY EVENT_NAME`,
      [schema, ...f.params, ...c.params]
    );
    return linhas.map((linha) => ({
      id: linha.EVENT_NAME,
      label: linha.EVENT_NAME,
      icon: 'event' as const,
      // O estado importa: um evento DISABLED existe e não roda, e a árvore que
      // mostra os dois iguais faz procurar defeito no lugar errado.
      detail: [linha.QUANDO, linha.STATUS === 'ENABLED' ? null : linha.STATUS]
        .filter((p) => p !== null && p !== '')
        .join(' · ') || undefined,
      hasChildren: false,
      actions: [
        { id: 'ddl', label: 'Ver DDL' },
        { id: 'drop-event', label: 'Apagar (DROP)', danger: true },
      ],
      meta: { schema, object: linha.EVENT_NAME, category: categoria },
    }));
  }

  const tipo = categoria === 'functions' ? 'FUNCTION' : 'PROCEDURE';
  const f = clausulaDeFiltro('ROUTINE_NAME', filtro);
  const c = condicoesDe(alvo, opcoes, "SUBSTRING_INDEX(DEFINER, '@', 1)");
  const linhas = await query<{ ROUTINE_NAME: string; DTD_IDENTIFIER: string | null }>(
    conn,
    `SELECT ROUTINE_NAME, DTD_IDENTIFIER
       FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?${f.sql}${c.sql}
      ORDER BY ROUTINE_NAME`,
    [schema, tipo, ...f.params, ...c.params]
  );
  return linhas.map((linha) => ({
    id: linha.ROUTINE_NAME,
    label: linha.ROUTINE_NAME,
    icon: (categoria === 'functions' ? 'function' : 'procedure') as TreeNode['icon'],
    detail: linha.DTD_IDENTIFIER ?? undefined,
    hasChildren: false,
    meta: { schema, object: linha.ROUTINE_NAME, category: categoria },
  }));
}

export async function listarColunas(conn: Connection, schema: string, objeto: string): Promise<TreeNode[]> {
  const linhas = await query<{
    COLUMN_NAME: string;
    COLUMN_TYPE: string;
    IS_NULLABLE: string;
    COLUMN_KEY: string;
  }>(
    conn,
    COLUNAS_ARVORE_SQL,
    [schema, objeto]
  );
  return linhas.map((linha) => {
    const marcas = [linha.COLUMN_TYPE];
    if (linha.COLUMN_KEY === 'PRI') marcas.push('PK');
    if (linha.IS_NULLABLE === 'NO') marcas.push('NOT NULL');
    return {
      id: linha.COLUMN_NAME,
      label: linha.COLUMN_NAME,
      icon: 'column' as const,
      detail: marcas.join(' · '),
      hasChildren: false,
      meta: { schema, object: objeto, column: linha.COLUMN_NAME },
    };
  });
}

