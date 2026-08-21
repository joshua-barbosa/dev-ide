// A estrutura de uma tabela PostgreSQL (spec 045).
//
// Ao contrário do MySQL, o PostgreSQL não tem `SHOW CREATE TABLE`: o DDL é
// reconstruído do catálogo, e o driver já fazia isso para a ação `Ver DDL`.
// Aqui a mesma função é reaproveitada — duas reconstruções do mesmo DDL
// divergiriam, e a divergência apareceria só num caso de canto.
//
// Índice, chave estrangeira e checagem saem de `pg_get_*def`, que devolvem o
// texto exato que o próprio banco usaria. É mais confiável que remontar a
// definição pedaço por pedaço.
import type { Client } from 'pg';
import type {
  ChaveEstrangeira,
  ChecagemDaTabela,
  ColunaDetalhada,
  GatilhoDaTabela,
  IndiceDaTabela,
  TableStructure,
} from '../types';

const COLUNAS = `
  SELECT a.attname AS nome,
         format_type(a.atttypid, a.atttypmod) AS tipo,
         information_schema._pg_char_max_length(a.atttypid, a.atttypmod) AS tamanho,
         col_description(c.oid, a.attnum) AS comentario,
         pg_get_expr(d.adbin, d.adrelid) AS padrao,
         a.attnotnull AS obrigatoria,
         COALESCE(i.indisprimary, false) AS chave,
         COALESCE(u.unico, false) AS unica,
         (pg_get_serial_sequence(c.oid::regclass::text, a.attname) IS NOT NULL
          OR a.attidentity <> '') AS auto
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    LEFT JOIN pg_index i ON i.indrelid = c.oid AND a.attnum = ANY(i.indkey) AND i.indisprimary
    LEFT JOIN LATERAL (
      SELECT true AS unico FROM pg_index x
       WHERE x.indrelid = c.oid AND x.indisunique AND x.indnatts = 1
         AND a.attnum = x.indkey[0]
    ) u ON true
   WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY a.attnum
`;

const INDICES = `
  SELECT i.relname AS nome, x.indisunique AS unico, am.amname AS tipo,
         ARRAY(SELECT pg_get_indexdef(x.indexrelid, k + 1, true)
                 FROM generate_subscripts(x.indkey, 1) AS k
                ORDER BY k) AS colunas
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_am am ON am.oid = i.relam
   WHERE n.nspname = $1 AND c.relname = $2
   ORDER BY i.relname
`;

const CHAVES_ESTRANGEIRAS = `
  SELECT con.conname AS nome,
         a.attname AS coluna,
         cl.relname AS tabela_ref,
         af.attname AS coluna_ref,
         con.confupdtype AS ao_atualizar,
         con.confdeltype AS ao_apagar
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class cl ON cl.oid = con.confrelid
    JOIN LATERAL unnest(con.conkey, con.confkey) AS u(k, fk) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.k
    JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = u.fk
   WHERE n.nspname = $1 AND c.relname = $2 AND con.contype = 'f'
   ORDER BY con.conname
`;

const GATILHOS = `
  SELECT t.tgname AS nome, pg_get_triggerdef(t.oid) AS definicao
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal
   ORDER BY t.tgname
`;

const CHECAGENS = `
  SELECT con.conname AS nome, pg_get_constraintdef(con.oid) AS expressao
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relname = $2 AND con.contype = 'c'
   ORDER BY con.conname
`;

const CABECALHO = `
  SELECT obj_description(c.oid) AS comentario,
         c.relkind AS especie,
         COALESCE(col.collname, 'default') AS colacao
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_collation col ON col.oid = c.reloftype
   WHERE n.nspname = $1 AND c.relname = $2
`;

/** As letras que o catálogo usa para as regras de integridade referencial. */
const REGRAS: Record<string, string> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

export async function estruturaDaTabela(
  client: Client,
  nodePath: readonly string[],
  ddlDe: (schema: string, objeto: string, ehView: boolean) => Promise<string>
): Promise<TableStructure> {
  const [, , schema, categoria, objeto] = nodePath;
  if (schema === undefined || objeto === undefined) {
    throw new Error('A estrutura exige um objeto selecionado.');
  }
  const ehView = categoria === 'views';
  const p = [schema, objeto];

  const [cabecalho, colunas, indices, fks, gatilhos, checagens, ddl] = await Promise.all([
    client.query<{ comentario: string | null; especie: string; colacao: string }>(CABECALHO, p),
    client.query<{
      nome: string; tipo: string; tamanho: number | null; comentario: string | null;
      padrao: string | null; obrigatoria: boolean; chave: boolean; unica: boolean; auto: boolean;
    }>(COLUNAS, p),
    client.query<{ nome: string; unico: boolean; tipo: string; colunas: string[] }>(INDICES, p),
    client.query<{
      nome: string; coluna: string; tabela_ref: string; coluna_ref: string;
      ao_atualizar: string; ao_apagar: string;
    }>(CHAVES_ESTRANGEIRAS, p),
    client.query<{ nome: string; definicao: string }>(GATILHOS, p),
    client.query<{ nome: string; expressao: string }>(CHECAGENS, p),
    ddlDe(schema, objeto, ehView),
  ]);

  if (colunas.rows.length === 0) throw new Error(`Objeto não encontrado: ${schema}.${objeto}`);

  return {
    nome: objeto,
    comentario: cabecalho.rows[0]?.comentario ?? null,
    // O PostgreSQL não tem "motor": o que existe é o método de acesso, e ele é
    // o mesmo em quase toda instalação. Dizer `heap` seria ruído.
    motor: null,
    colacao: cabecalho.rows[0]?.colacao ?? null,
    ehView,
    ddl,
    colunas: colunas.rows.map(
      (c): ColunaDetalhada => ({
        name: c.nome,
        type: c.tipo,
        tamanho: c.tamanho,
        comentario: c.comentario,
        padrao: c.padrao,
        obrigatoria: c.obrigatoria,
        chave: c.chave,
        unica: c.unica,
        autoIncremento: c.auto,
      })
    ),
    chavesEstrangeiras: {
      itens: fks.rows.map(
        (f): ChaveEstrangeira => ({
          nome: f.nome,
          coluna: f.coluna,
          tabelaReferenciada: f.tabela_ref,
          colunaReferenciada: f.coluna_ref,
          aoAtualizar: REGRAS[f.ao_atualizar] ?? f.ao_atualizar,
          aoApagar: REGRAS[f.ao_apagar] ?? f.ao_apagar,
        })
      ),
    },
    indices: {
      itens: indices.rows.map(
        (i): IndiceDaTabela => ({
          nome: i.nome,
          colunas: i.colunas,
          unico: i.unico,
          tipo: i.tipo,
        })
      ),
    },
    gatilhos: {
      itens: gatilhos.rows.map((g): GatilhoDaTabela => {
        // `pg_get_triggerdef` devolve a definição inteira numa linha. Momento e
        // evento são extraídos dela porque o catálogo os guarda como máscara de
        // bits, e traduzir a máscara à mão erraria nos gatilhos de vários eventos.
        const def = g.definicao;
        return {
          nome: g.nome,
          momento: /\b(BEFORE|AFTER|INSTEAD OF)\b/i.exec(def)?.[1]?.toUpperCase() ?? '?',
          evento: /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.exec(def)?.[1]?.toUpperCase() ?? '?',
          orientacao: /FOR EACH (ROW|STATEMENT)/i.exec(def)?.[1]?.toUpperCase() ?? null,
          corpo: def,
        };
      }),
    },
    checagens: {
      itens: checagens.rows.map(
        (c): ChecagemDaTabela => ({ nome: c.nome, expressao: c.expressao })
      ),
    },
  };
}
