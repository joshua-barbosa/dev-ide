// A aba de tabela do MySQL: ler página e escrever pela grade.
//
// Saiu de `mysql.ts` quando ele passou do teto de 800 linhas do Artigo IV — o
// portão da spec 028 o pegou em 807. O corte é por assunto: tudo aqui responde
// à aba de tabela das specs 041 e 044, e nada disto é usado pela árvore nem
// pelo editor de query.
import type { Connection } from 'mysql2';
import type {
  TableColumn,
  TableRequest,
  TablePage,
  TableWriteRequest,
  TableWriteResult,
} from '../types';
import {
  COLUNAS_TABELA_SQL,
  ESTIMATIVA_SQL,
} from './mysql-sql';
import {
  APELIDO_DA_CONTAGEM,
  montarConsultaDeTabela,
  normalizarPedidoDeTabela,
} from './tabela';
import { escreverNaTabela } from './transacao';
import { executar, qualificar, query } from './mysql-base';

// ---------------------------------------------------------------------------
// A aba de tabela (spec 041)
// ---------------------------------------------------------------------------

/**
 * O total de linhas, contado de verdade — ou estimado, quando contar custaria caro.
 *
 * `COUNT(*)` no InnoDB varre o índice: numa tabela de 169 milhões de linhas
 * (a `alternativas` do usuário) isso é dezenas de segundos, e a aba ficaria
 * pendurada. Acima do teto, devolve-se a estimativa do catálogo **dizendo que é
 * estimativa** — mostrar um número exato que não é seria pior que não mostrar.
 *
 * Com filtro em vigor não há estimativa possível: aí conta-se, porque o filtro
 * costuma reduzir muito, e um total errado faria a paginação mentir.
 */
const MAX_LINHAS_PARA_CONTAR = 5_000_000;

async function totalDaTabela(
  conn: Connection,
  schema: string,
  objeto: string,
  contagemSql: string,
  params: readonly string[]
): Promise<{ total: number | null; totalEstimado: number | null }> {
  const [estimativa] = await query<{ n: number | null }>(
    conn,
    ESTIMATIVA_SQL,
    [schema, objeto]
  );
  const aproximado = estimativa?.n === null || estimativa?.n === undefined
    ? null
    : Number(estimativa.n);

  if (params.length === 0 && aproximado !== null && aproximado > MAX_LINHAS_PARA_CONTAR) {
    return { total: null, totalEstimado: aproximado };
  }
  const [linha] = await query<Record<string, unknown>>(conn, contagemSql, [...params]);
  return { total: Number(linha?.[APELIDO_DA_CONTAGEM] ?? 0), totalEstimado: aproximado };
}

export async function lerTabela(
  conn: Connection,
  request: TableRequest,
  limitePadrao: number
): Promise<TablePage> {
  const [, schema, , objeto] = request.nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('A aba de tabela exige um objeto selecionado.');
  }
  const colunas = await colunasDaTabela(conn, schema, objeto);
  const pedido = normalizarPedidoDeTabela(
    { ...request, porPagina: request.porPagina || limitePadrao },
    colunas.map((c) => c.name)
  );
  const alvo = qualificar(schema, objeto);
  const { sql, contagem, params } = montarConsultaDeTabela(
    { alvo, colunas: colunas.map((c) => c.name), estilo: 'backtick' },
    pedido
  );

  const [resultado, totais] = await Promise.all([
    executar(conn, { statement: sql, rowLimit: pedido.porPagina }, params),
    totalDaTabela(conn, schema, objeto, contagem, params),
  ]);
  return { resultado, columns: colunas, sql, ...totais };
}

/** As colunas da tabela, com chave e obrigatoriedade — o cabeçalho da aba. */
export async function colunasDaTabela(
  conn: Connection,
  schema: string,
  objeto: string
): Promise<TableColumn[]> {
  const linhas = await query<{
    COLUMN_NAME: string; COLUMN_TYPE: string; COLUMN_KEY: string; IS_NULLABLE: string;
  }>(
    conn,
    COLUNAS_TABELA_SQL,
    [schema, objeto]
  );
  if (linhas.length === 0) throw new Error(`Tabela não encontrada: ${schema}.${objeto}`);
  return linhas.map((l) => ({
    name: l.COLUMN_NAME,
    type: l.COLUMN_TYPE,
    chave: l.COLUMN_KEY === 'PRI',
    obrigatoria: l.IS_NULLABLE === 'NO',
  }));
}

/** Escrever pela grade (spec 044), em uma transação. */
export async function escrever(
  conn: Connection,
  request: TableWriteRequest
): Promise<TableWriteResult> {
  const [, schema, , objeto] = request.nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('A escrita exige um objeto selecionado.');
  }
  const colunas = await colunasDaTabela(conn, schema, objeto);

  return escreverNaTabela(
    {
      alvo: qualificar(schema, objeto),
      colunas: colunas.map((c) => ({ name: c.name, chave: c.chave })),
      estilo: 'backtick',
    },
    request,
    {
      comecar: async () => { await query(conn, 'START TRANSACTION'); },
      confirmar: async () => { await query(conn, 'COMMIT'); },
      desfazer: async () => { await query(conn, 'ROLLBACK'); },
      rodar: async (sql, params) => {
        const r = (await query<unknown>(conn, sql, params as never[])) as unknown as {
          affectedRows?: number;
        };
        return Number(r?.affectedRows ?? 0);
      },
    }
  );
}
