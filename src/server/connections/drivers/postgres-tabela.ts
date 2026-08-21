// A aba de tabela do PostgreSQL: ler página e escrever pela grade.
//
// Saiu de `postgres.ts` quando ele passou do teto de 800 linhas do Artigo IV —
// o portão da spec 028 o pegou em 811, ao ganhar a lista de processos (spec
// 047). Mesmo corte que o MySQL levou na spec 044, e pelo mesmo motivo: tudo
// aqui responde à aba de tabela, e nada disto é usado pela árvore.
import type { Client } from 'pg';
import type {
  ExecuteRequest,
  QueryResult,
  TableColumn,
  TablePage,
  TableRequest,
  TableWriteRequest,
  TableWriteResult,
} from '../types';
import { quoteIdentifier } from './sql-base';
import { COLUNAS_SQL, ESTIMATIVA_SQL } from './postgres-sql';
import {
  APELIDO_DA_CONTAGEM,
  montarConsultaDeTabela,
  normalizarPedidoDeTabela,
} from './tabela';
import { escreverNaTabela } from './transacao';

/** Quem executa a consulta da página — vem de `postgres.ts`, que a implementa. */
export type Executor = (
  client: Client,
  request: ExecuteRequest,
  limitePadrao: number,
  params?: readonly string[]
) => Promise<QueryResult>;

/**
 * O total, contado — ou estimado, quando contar custaria caro.
 *
 * `COUNT(*)` no PostgreSQL varre a tabela. Acima do teto usa-se `reltuples` do
 * catálogo, **dizendo que é estimativa**. Com filtro em vigor conta-se sempre:
 * não há estimativa possível para um `WHERE`.
 */
const MAX_LINHAS_PARA_CONTAR = 5_000_000;

export async function lerTabela(
  client: Client,
  request: TableRequest,
  limitePadrao: number,
  executar: Executor
): Promise<TablePage> {
  const [, , schema, , objeto] = request.nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('A aba de tabela exige um objeto selecionado.');
  }

  const { rows: cols } = await client.query<{
    nome: string; tipo: string; obrigatorio: boolean; pk: boolean;
  }>(COLUNAS_SQL, [schema, objeto]);
  if (cols.length === 0) throw new Error(`Tabela não encontrada: ${schema}.${objeto}`);
  const colunas: TableColumn[] = cols.map((c) => ({
    name: c.nome, type: c.tipo, chave: c.pk, obrigatoria: c.obrigatorio,
  }));

  const pedido = normalizarPedidoDeTabela(
    { ...request, porPagina: request.porPagina || limitePadrao },
    colunas.map((c) => c.name)
  );
  const alvo = `${quoteIdentifier(schema, 'double')}.${quoteIdentifier(objeto, 'double')}`;
  const { sql, contagem, params } = montarConsultaDeTabela(
    { alvo, colunas: colunas.map((c) => c.name), estilo: 'double', marcador: 'numerado' },
    pedido
  );

  const { rows: est } = await client.query<{ n: string | null }>(ESTIMATIVA_SQL, [schema, objeto]);
  const bruto = est[0]?.n;
  const aproximado = bruto === null || bruto === undefined ? null : Number(bruto);

  let total: number | null = null;
  if (params.length > 0 || aproximado === null || aproximado <= MAX_LINHAS_PARA_CONTAR) {
    const { rows } = await client.query<Record<string, unknown>>(contagem, [...params]);
    total = Number(rows[0]?.[APELIDO_DA_CONTAGEM] ?? 0);
  }

  const resultado = await executar(
    client, { statement: sql, rowLimit: pedido.porPagina }, pedido.porPagina, params
  );
  return { resultado, columns: colunas, sql, total, totalEstimado: aproximado };
}

/** Escrever pela grade (spec 044), em uma transação. */
export async function escrever(
  client: Client,
  request: TableWriteRequest
): Promise<TableWriteResult> {
  const [, , schema, , objeto] = request.nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('A escrita exige um objeto selecionado.');
  }
  const { rows } = await client.query<{ nome: string; pk: boolean }>(COLUNAS_SQL, [schema, objeto]);
  if (rows.length === 0) throw new Error(`Tabela não encontrada: ${schema}.${objeto}`);

  return escreverNaTabela(
    {
      alvo: `${quoteIdentifier(schema, 'double')}.${quoteIdentifier(objeto, 'double')}`,
      colunas: rows.map((c) => ({ name: c.nome, chave: c.pk })),
      estilo: 'double',
      marcador: 'numerado',
    },
    request,
    {
      comecar: async () => { await client.query('BEGIN'); },
      confirmar: async () => { await client.query('COMMIT'); },
      desfazer: async () => { await client.query('ROLLBACK'); },
      rodar: async (sql, params) => (await client.query(sql, [...params])).rowCount ?? 0,
    }
  );
}
