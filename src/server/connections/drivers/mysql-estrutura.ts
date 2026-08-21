// A estrutura de uma tabela MySQL (spec 045).
//
// Tudo vem do `information_schema`, e tudo numa ida só: seis consultas em
// paralelo custam uma latência, não seis.
//
// O `SHOW CREATE TABLE` continua sendo a fonte do DDL — reconstruí-lo do
// catálogo daria um texto parecido e não idêntico, e "parecido" num DDL é a
// pior categoria de resposta.
import type { Connection } from 'mysql2';
import type {
  ChaveEstrangeira,
  ChecagemDaTabela,
  ColunaDetalhada,
  GatilhoDaTabela,
  IndiceDaTabela,
  TableStructure,
} from '../types';
import { query, qualificar } from './mysql-base';

interface LinhaDeColuna {
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  COLUMN_COMMENT: string | null;
  COLUMN_DEFAULT: string | null;
  IS_NULLABLE: string;
  COLUMN_KEY: string;
  EXTRA: string | null;
}

export async function estruturaDaTabela(
  conn: Connection,
  nodePath: readonly string[]
): Promise<TableStructure> {
  const [, schema, categoria, objeto] = nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('A estrutura exige um objeto selecionado.');
  }
  const ehView = categoria === 'views';
  const alvo = qualificar(schema, objeto);

  const [tabela, colunas, fks, indices, gatilhos, checagens, ddl] = await Promise.all([
    query<{ TABLE_COMMENT: string | null; ENGINE: string | null; TABLE_COLLATION: string | null }>(
      conn,
      `SELECT TABLE_COMMENT, ENGINE, TABLE_COLLATION
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [schema, objeto]
    ),
    query<LinhaDeColuna>(
      conn,
      `SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION,
              COLUMN_COMMENT, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_KEY, EXTRA
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [schema, objeto]
    ),
    query<{
      CONSTRAINT_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string;
      REFERENCED_COLUMN_NAME: string; UPDATE_RULE: string; DELETE_RULE: string;
    }>(
      conn,
      `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
              k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ?
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [schema, objeto]
    ),
    query<{ INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number; INDEX_TYPE: string }>(
      conn,
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [schema, objeto]
    ),
    query<{
      TRIGGER_NAME: string; ACTION_TIMING: string; EVENT_MANIPULATION: string;
      ACTION_ORIENTATION: string | null; ACTION_STATEMENT: string;
    }>(
      conn,
      `SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION,
              ACTION_ORIENTATION, ACTION_STATEMENT
         FROM information_schema.TRIGGERS
        WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
        ORDER BY TRIGGER_NAME`,
      [schema, objeto]
    ),
    // `CHECK_CONSTRAINTS` só existe a partir do MySQL 8.0.16. Falhar aqui
    // derrubaria a tela inteira por causa de uma sub-aba, então o erro vira
    // "não sei" — que é a resposta honesta para um servidor mais velho.
    query<{ CONSTRAINT_NAME: string; CHECK_CLAUSE: string }>(
      conn,
      `SELECT c.CONSTRAINT_NAME, c.CHECK_CLAUSE
         FROM information_schema.CHECK_CONSTRAINTS c
         JOIN information_schema.TABLE_CONSTRAINTS t
           ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA
          AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME
        WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?`,
      [schema, objeto]
    ).catch(() => null),
    query<Record<string, string>>(conn, `SHOW CREATE ${ehView ? 'VIEW' : 'TABLE'} ${alvo}`),
  ]);

  if (colunas.length === 0) throw new Error(`Objeto não encontrado: ${schema}.${objeto}`);

  // Agrupa as linhas de índice por nome: o catálogo devolve uma por coluna.
  const porIndice = new Map<string, IndiceDaTabela>();
  for (const linha of indices) {
    const atual = porIndice.get(linha.INDEX_NAME);
    if (atual === undefined) {
      porIndice.set(linha.INDEX_NAME, {
        nome: linha.INDEX_NAME,
        colunas: [linha.COLUMN_NAME],
        unico: linha.NON_UNIQUE === 0,
        tipo: linha.INDEX_TYPE,
      });
    } else {
      porIndice.set(linha.INDEX_NAME, {
        ...atual,
        colunas: [...atual.colunas, linha.COLUMN_NAME],
      });
    }
  }

  const primeira = ddl[0];
  const chaveDoDdl =
    primeira === undefined ? undefined : Object.keys(primeira).find((k) => /^create/i.test(k));

  return {
    nome: objeto,
    comentario: tabela[0]?.TABLE_COMMENT || null,
    motor: tabela[0]?.ENGINE ?? null,
    colacao: tabela[0]?.TABLE_COLLATION ?? null,
    ehView,
    ddl: chaveDoDdl === undefined ? '' : `${primeira?.[chaveDoDdl] ?? ''};`,
    colunas: colunas.map(
      (c): ColunaDetalhada => ({
        name: c.COLUMN_NAME,
        type: c.COLUMN_TYPE,
        tamanho: c.CHARACTER_MAXIMUM_LENGTH ?? c.NUMERIC_PRECISION,
        comentario: c.COLUMN_COMMENT || null,
        padrao: c.COLUMN_DEFAULT,
        obrigatoria: c.IS_NULLABLE === 'NO',
        chave: c.COLUMN_KEY === 'PRI',
        unica: c.COLUMN_KEY === 'UNI',
        autoIncremento: /auto_increment/i.test(c.EXTRA ?? ''),
      })
    ),
    chavesEstrangeiras: {
      itens: fks.map(
        (f): ChaveEstrangeira => ({
          nome: f.CONSTRAINT_NAME,
          coluna: f.COLUMN_NAME,
          tabelaReferenciada: f.REFERENCED_TABLE_NAME,
          colunaReferenciada: f.REFERENCED_COLUMN_NAME,
          aoAtualizar: f.UPDATE_RULE,
          aoApagar: f.DELETE_RULE,
        })
      ),
    },
    indices: { itens: [...porIndice.values()] },
    gatilhos: {
      itens: gatilhos.map(
        (g): GatilhoDaTabela => ({
          nome: g.TRIGGER_NAME,
          momento: g.ACTION_TIMING,
          evento: g.EVENT_MANIPULATION,
          orientacao: g.ACTION_ORIENTATION,
          corpo: g.ACTION_STATEMENT,
        })
      ),
    },
    checagens:
      checagens === null
        ? {
            naoSei:
              'Este servidor MySQL não expõe `CHECK_CONSTRAINTS` — ele existe a partir da ' +
              'versão 8.0.16.',
          }
        : {
            itens: checagens.map(
              (c): ChecagemDaTabela => ({
                nome: c.CONSTRAINT_NAME,
                expressao: c.CHECK_CLAUSE,
              })
            ),
          },
  };
}
