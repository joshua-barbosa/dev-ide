// As primitivas do driver MySQL, compartilhadas por seus arquivos.
//
// Saíram para cá quando `mysql.ts` passou do teto de 800 linhas do Artigo IV e
// a aba de tabela virou arquivo próprio: os dois precisam disto, e deixá-las
// num deles criaria dependência circular entre os dois.
//
// Nada aqui decide nada — é a camada mais fina possível sobre o `mysql2`.
import type { Connection } from 'mysql2';
import type { CellValue, ColumnInfo, ExecuteRequest, QueryResult } from '../types';
import { Types, type FieldPacket } from 'mysql2';
import { formatCell, quoteIdentifier, resolveRowLimit } from './sql-base';

/** Códigos numéricos de tipo -> nome legível, para o cabeçalho do grid. */
const TYPE_NAMES = new Map<number, string>(
  Object.entries(Types)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, code]) => [code, name.toLowerCase()])
);

export function colunasDe(fields: FieldPacket[] | undefined): ColumnInfo[] {
  return (fields ?? []).map((field) => ({
    name: field.name,
    type: TYPE_NAMES.get(field.columnType ?? -1),
  }));
}

/**
 * Promessa em cima da API de callback do `mysql2`.
 *
 * O `errno` e o `code` do MySQL viajam junto com o erro. Antes da spec 069 só a
 * mensagem sobrevivia, e isso quebrou uma feature de verdade: a sonda do
 * `Security` classifica "sem permissão" pelo CÓDIGO — nunca pelo texto, porque
 * "denied" aparece em erro de proxy e de firewall também. Sem o código, a
 * recusa esperada de `mysql.user` virou erro fatal e derrubou a árvore inteira.
 */
export function query<T>(conn: Connection, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) reject(Object.assign(new Error(err.message), { errno: err.errno, code: err.code }));
      else resolve(rows as T[]);
    });
  });
}

/** Nome de tabela qualificado pelo schema, com as duas partes citadas. */
export function qualificar(schema: string, objeto: string): string {
  return `${quoteIdentifier(schema, 'backtick')}.${quoteIdentifier(objeto, 'backtick')}`;
}

export function executar(
  conn: Connection,
  request: ExecuteRequest,
  params: readonly string[] = []
): Promise<QueryResult> {
  const limite = resolveRowLimit(request.rowLimit);
  // Linhas a pular (T056). O fluxo já existe; pular é não guardar.
  const pular = Math.max(0, Math.trunc(request.offset ?? 0));
  let puladas = 0;
  const inicio = Date.now();

  return new Promise((resolve, reject) => {
    const q = params.length === 0
      ? conn.query(request.statement)
      : conn.query(request.statement, [...params]);
    let colunas: ColumnInfo[] = [];
    // 'fields' só dispara em result set; a ausência dele identifica DML/DDL.
    q.on('fields', (fields: FieldPacket[]) => {
      colunas = colunasDe(fields);
    });

    const rows: CellValue[][] = [];
    let truncated = false;
    let afetadas = 0;

    const stream = q.stream();
    stream.on('data', (registro: Record<string, unknown>) => {
      if (colunas.length === 0) {
        // OkPacket de INSERT/UPDATE/DDL: não há linhas, só o total afetado.
        afetadas = Number(registro.affectedRows ?? 0);
        return;
      }
      if (puladas < pular) {
        puladas += 1;
        return;
      }
      if (rows.length >= limite) {
        truncated = true;
        stream.destroy(); // para de puxar do servidor em vez de baixar tudo
        return;
      }
      rows.push(colunas.map((coluna) => formatCell(registro[coluna.name])));
    });

    stream.on('error', (err: Error) => reject(new Error(err.message)));
    const finalizar = () =>
      resolve({
        columns: colunas,
        rows,
        rowCount: colunas.length === 0 ? afetadas : rows.length,
        durationMs: Date.now() - inicio,
        truncated,
        message: colunas.length === 0 ? `${afetadas} linha(s) afetada(s).` : undefined,
      });
    stream.on('end', finalizar);
    stream.on('close', finalizar); // destroy() encerra por aqui
  });
}
