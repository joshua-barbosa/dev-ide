// O DDL de uma tabela ou view do PostgreSQL, reconstruído do catálogo.
//
// Saiu do `postgres.ts` na spec 082, quando o arquivo bateu no teto de 800
// linhas do Artigo IV. É um assunto fechado — entra um objeto, sai o texto do
// `CREATE` — e o driver continua sendo quem o oferece.
import type { Client } from 'pg';
import { quoteIdentifier } from './sql-base';
import { DDL_COLUNAS_SQL, DDL_PK_SQL } from './postgres-sql';

export async function ddlDe(
  client: Client,
  schema: string,
  objeto: string,
  ehView: boolean
): Promise<string> {
  const alvo = `${quoteIdentifier(schema, 'double')}.${quoteIdentifier(objeto, 'double')}`;
  if (ehView) {
    const { rows } = await client.query<{ def: string }>(
      'SELECT pg_get_viewdef($1::regclass, true) AS def',
      [alvo]
    );
    return `CREATE OR REPLACE VIEW ${alvo} AS\n${rows[0]?.def ?? ''}`;
  }

  // O Postgres não tem SHOW CREATE TABLE: o DDL é reconstruído do catálogo.
  // Cobre colunas, NOT NULL, DEFAULT e chave primária — não índices,
  // constraints de checagem nem chaves estrangeiras. A aba de estrutura mostra
  // esses três em listas próprias, que é onde eles ficam legíveis mesmo.
  const [colunas, pk] = await Promise.all([
    client.query<{ nome: string; tipo: string; obrigatorio: boolean; padrao: string | null }>(
      DDL_COLUNAS_SQL, [schema, objeto]
    ),
    client.query<{ nome: string }>(DDL_PK_SQL, [schema, objeto]),
  ]);

  const linhas = colunas.rows.map((coluna) => {
    const partes = [`  ${quoteIdentifier(coluna.nome, 'double')} ${coluna.tipo}`];
    if (coluna.padrao !== null) partes.push(`DEFAULT ${coluna.padrao}`);
    if (coluna.obrigatorio) partes.push('NOT NULL');
    return partes.join(' ');
  });
  if (pk.rows.length > 0) {
    const cols = pk.rows.map((r) => quoteIdentifier(r.nome, 'double')).join(', ');
    linhas.push(`  PRIMARY KEY (${cols})`);
  }

  return (
    '-- Reconstruído do catálogo: sem índices, FKs e constraints de checagem.\n' +
    `CREATE TABLE ${alvo} (\n${linhas.join(',\n')}\n);\n`
  );
}
