// As categorias da árvore do SQL Server e o que há dentro delas.
//
// Nasceu de dois pedidos dele em 03/09/2026 — o interruptor de Type, Trigger e
// Sequence, e a categoria de Triggers — e de um defeito que apareceu ao ir
// escrever: a árvore ia do banco DIRETO para as tabelas, e o nível do meio
// nunca existiu. Pior: `children(['banco'])` devolvia a lista de BANCOS de
// novo, porque o teste de nível dizia `<= 1` e a leitura do banco dizia
// `nodePath[1]`. Nunca se chegava a uma tabela expandindo a árvore.
//
// Agora a forma é a mesma dos outros três SQL: servidor → banco → categoria →
// objeto → coluna.
import { quoteIdentifier } from './sql-base';
import {
  camposDeVisibilidade, filtrarCategorias, type CategoriaOpcional,
} from '../../../shared/sql/categorias-visiveis';
import type { TreeNode } from '../types';

interface Categoria {
  readonly id: string;
  readonly label: string;
  readonly icon: TreeNode['icon'];
  /** O objeto tem colunas para expandir. */
  readonly expande: boolean;
  /** A view do catálogo de onde os nomes saem. */
  readonly de: string;
  /** Filtro extra, quando a view do catálogo mistura espécies. */
  readonly onde?: string;
}

export const CATEGORIAS: readonly Categoria[] = [
  { id: 'tables', label: 'Tables', icon: 'table', expande: true, de: 'sys.tables' },
  { id: 'views', label: 'Views', icon: 'view', expande: true, de: 'sys.views' },
  // `FN` escalar, `IF` inline e `TF` de tabela — as três espécies de função.
  // `sys.objects` mistura tudo, então o filtro é obrigatório aqui.
  {
    id: 'functions', label: 'Functions', icon: 'function', expande: false,
    de: 'sys.objects', onde: "type IN ('FN', 'IF', 'TF')",
  },
  { id: 'procedures', label: 'Procedures', icon: 'procedure', expande: false, de: 'sys.procedures' },
  { id: 'triggers', label: 'Triggers', icon: 'trigger', expande: false, de: 'sys.triggers' },
  { id: 'sequences', label: 'Sequences', icon: 'sequence', expande: false, de: 'sys.sequences' },
  {
    id: 'types', label: 'Types', icon: 'type', expande: false,
    de: 'sys.types', onde: 'is_user_defined = 1',
  },
];

/**
 * As que ganham interruptor no cadastro (03/09/2026, ele).
 *
 * São exatamente as três que ele nomeou e que o SQL Server tem. Foreign table e
 * materialized view não entram: o SQL Server não tem nenhuma das duas — a
 * external table do PolyBase e a indexed view são outra coisa, e chamá-las
 * assim faria a árvore mentir.
 */
export const OPCIONAIS: readonly CategoriaOpcional[] = [
  { id: 'triggers', label: 'Triggers', padrao: true },
  { id: 'sequences', label: 'Sequences', padrao: true },
  {
    id: 'types', label: 'Types', padrao: true,
    ajuda: 'Só os definidos por alguém — os tipos nativos do servidor ficam fora.',
  },
];

export const CAMPOS_DE_ARVORE = camposDeVisibilidade(OPCIONAIS);

const banco = (nome: string): string => quoteIdentifier(nome, 'bracket');

/** Quantos objetos de cada categoria, numa consulta só. */
export function contagensSql(nomeDoBanco: string): string {
  const partes = CATEGORIAS.map((c) => {
    const onde = c.onde === undefined ? '' : ` WHERE ${c.onde}`;
    return `    (SELECT COUNT(*) FROM ${banco(nomeDoBanco)}.${c.de}${onde}) AS [${c.id}]`;
  });
  return `SELECT\n${partes.join(',\n')}`;
}

/**
 * Os objetos de uma categoria, com o schema a que pertencem.
 *
 * `sys.types` e `sys.triggers` não têm `schema_id` utilizável do mesmo jeito
 * que as demais — o gatilho pende de uma tabela, e o tipo mora no schema mas a
 * coluna se chama igual. O `LEFT JOIN` cobre os dois casos sem ramificar a
 * consulta.
 */
export function objetosSql(nomeDoBanco: string, categoria: Categoria): string {
  const b = banco(nomeDoBanco);
  if (categoria.id === 'triggers') {
    return `
      SELECT tg.name AS nome, t.name AS dono
        FROM ${b}.sys.triggers tg
        LEFT JOIN ${b}.sys.tables t ON t.object_id = tg.parent_id
       ORDER BY tg.name`;
  }
  const onde = categoria.onde === undefined ? '' : ` WHERE o.${categoria.onde}`;
  return `
    SELECT o.name AS nome, s.name AS dono
      FROM ${b}.${categoria.de} o
      LEFT JOIN ${b}.sys.schemas s ON s.schema_id = o.schema_id${onde}
     ORDER BY s.name, o.name`;
}

/** As colunas de uma tabela ou view. */
export function colunasSql(nomeDoBanco: string, schema: string, objeto: string): string {
  const b = banco(nomeDoBanco);
  return `
    SELECT c.COLUMN_NAME AS nome, c.DATA_TYPE AS tipo, c.IS_NULLABLE AS aceita_nulo
      FROM ${b}.INFORMATION_SCHEMA.COLUMNS c
     WHERE c.TABLE_SCHEMA = '${schema.replaceAll("'", "''")}'
       AND c.TABLE_NAME = '${objeto.replaceAll("'", "''")}'
     ORDER BY c.ORDINAL_POSITION`;
}

/** Os nós de categoria daquele banco, já peneirados pelo cadastro. */
export function nosDeCategoria(
  nomeDoBanco: string,
  contagens: Readonly<Record<string, unknown>>,
  campos: Readonly<Record<string, string | number | boolean>>
): TreeNode[] {
  return filtrarCategorias(CATEGORIAS, OPCIONAIS, campos).map((categoria) => {
    // `null` e ausente são a mesma coisa aqui: "não sei", e não "zero". Zero é
    // uma afirmação — mostrá-lo onde não se sabe faz procurar objeto que talvez
    // exista. (`Number(null)` é 0, e é por isso que o caso é explícito.)
    const bruto = contagens[categoria.id];
    const n = bruto === null || bruto === undefined ? NaN : Number(bruto);
    return {
      id: categoria.id,
      label: categoria.label,
      icon: categoria.icon,
      detail: Number.isFinite(n) ? String(n) : undefined,
      hasChildren: true,
      meta: { database: nomeDoBanco, categoria: true, criterios: ['nome'] },
    };
  });
}

/** A categoria expande em colunas? */
export function expandeEmColunas(id: string | undefined): boolean {
  return CATEGORIAS.find((c) => c.id === id)?.expande === true;
}
