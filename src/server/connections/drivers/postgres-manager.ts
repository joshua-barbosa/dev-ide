// A aba `Manager` do PostgreSQL: Dashboard, Log e Structure Sync (T070).
//
// Mesma forma do `mysql-manager.ts`, e as mesmas duas regras: **só leitura**, e
// o Structure Sync **gera texto**, não aplica.
//
// O que muda do MySQL é o vocabulário, e ele muda bastante: no Postgres os
// números vêm de VISÕES (`pg_stat_database`, `pg_stat_bgwriter`) em vez de um
// `SHOW STATUS`, e são por banco — não do servidor inteiro. Isso está dito no
// grupo de cada métrica, porque somar dois bancos daria um número que não
// significa nada.
import type {
  ColunaDaEstrutura, IndiceDaEstrutura, LinhaDeLog, MetricaDoBanco,
  RetratoDaEstrutura, TabelaDaEstrutura,
} from '../../../shared/sql/manager';

/** Uma consulta parametrizada — a forma que o `pg` usa. */
type Consulta = <T>(sql: string, valores?: readonly unknown[]) => Promise<readonly T[]>;

/**
 * Dashboard: os números do servidor e do banco atual.
 *
 * Duas consultas, e não uma por número: `pg_stat_database` já traz tudo do
 * banco numa linha só.
 */
export async function metricasDoPostgres(query: Consulta): Promise<readonly MetricaDoBanco[]> {
  const saida: MetricaDoBanco[] = [];

  const gerais = await query<{ nome: string; valor: string }>(
    `SELECT 'version' AS nome, version() AS valor
     UNION ALL SELECT 'uptime', date_trunc('second', now() - pg_postmaster_start_time())::text
     UNION ALL SELECT 'max_connections', current_setting('max_connections')
     UNION ALL SELECT 'shared_buffers', current_setting('shared_buffers')
     UNION ALL SELECT 'work_mem', current_setting('work_mem')
     UNION ALL SELECT 'conexoes', count(*)::text FROM pg_stat_activity`
  );
  for (const g of gerais) {
    saida.push({ nome: g.nome, valor: String(g.valor), grupo: 'Servidor' });
  }

  const doBanco = await query<{
    numbackends: number; xact_commit: string; xact_rollback: string;
    blks_read: string; blks_hit: string; deadlocks: string;
    tup_returned: string; tup_fetched: string; temp_bytes: string;
  }>(
    `SELECT numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
            deadlocks, tup_returned, tup_fetched, temp_bytes
       FROM pg_stat_database WHERE datname = current_database()`
  );

  const b = doBanco[0];
  if (b !== undefined) {
    // O grupo diz "deste banco" de propósito: no Postgres estes números são por
    // banco, e não do servidor. Somar dois bancos daria um total sem sentido.
    const grupo = 'Deste banco';
    saida.push(
      { nome: 'Conexões', valor: String(b.numbackends), grupo },
      { nome: 'Commits', valor: String(b.xact_commit), grupo },
      {
        nome: 'Rollbacks',
        valor: String(b.xact_rollback),
        grupo,
        ajuda: 'Muitos rollbacks costumam ser erro de aplicação, e não do banco.',
      },
      {
        nome: 'Deadlocks',
        valor: String(b.deadlocks),
        grupo,
        ajuda: 'Qualquer número acima de zero merece uma olhada.',
      },
      {
        nome: 'Arquivos temporários (bytes)',
        valor: String(b.temp_bytes),
        grupo,
        ajuda: 'Consulta que não coube em `work_mem` e foi para o disco.',
      }
    );

    const lidos = Number(b.blks_read);
    const cache = Number(b.blks_hit);
    if (Number.isFinite(lidos) && Number.isFinite(cache) && lidos + cache > 0) {
      saida.push({
        nome: 'Cache hit rate',
        valor: `${((cache / (lidos + cache)) * 100).toFixed(2)}%`,
        grupo,
        ajuda: 'Quanto foi atendido pela memória. Abaixo de 95% costuma doer.',
      });
    }
  }

  return saida;
}

/**
 * Log: só quando o servidor guarda em tabela, via `pg_log` ou extensão.
 *
 * O padrão do Postgres é gravar em ARQUIVO, e não existe SQL que leia isso —
 * `pg_read_file` exige superusuário e o caminho absoluto, e recusar em silêncio
 * seria pior que dizer que não dá. Quem tem o arquivo lê pelo SSH, que a IDE já
 * oferece na aba do servidor.
 */
export async function logDoPostgres(
  query: Consulta,
  limite: number
): Promise<readonly LinhaDeLog[] | null> {
  // `to_regclass` devolve nulo quando a tabela não existe — é a pergunta
  // "existe?" sem tentar ler e tratar o erro.
  const existe = await query<{ tabela: string | null }>(
    `SELECT to_regclass('public.postgres_log')::text AS tabela`
  );
  if (existe[0]?.tabela == null) return null;

  const n = Math.max(1, Math.min(1_000, Math.trunc(limite)));
  const linhas = await query<{ log_time: unknown; error_severity: unknown; message: unknown }>(
    `SELECT log_time, error_severity, message
       FROM public.postgres_log
      ORDER BY log_time DESC
      LIMIT $1`,
    [n]
  );
  return linhas.map((l) => ({
    quando: l.log_time === null || l.log_time === undefined ? null : String(l.log_time),
    nivel: nivelDoPostgres(String(l.error_severity ?? '')),
    texto: String(l.message ?? ''),
  }));
}

/**
 * A severidade do Postgres traduzida.
 *
 * Vale a tabela própria, e não o reconhecedor por texto: aqui a severidade vem
 * num CAMPO, e adivinhá-la pelo texto da mensagem seria trocar um dado certo
 * por um palpite.
 */
export function nivelDoPostgres(severidade: string): LinhaDeLog['nivel'] {
  const s = severidade.toUpperCase();
  if (['ERROR', 'FATAL', 'PANIC'].includes(s)) return 'erro';
  if (s === 'WARNING') return 'aviso';
  if (['LOG', 'INFO', 'NOTICE', 'DEBUG'].includes(s)) return 'nota';
  return 'outro';
}

/** Structure Sync: o retrato de um schema. */
export async function estruturaDoPostgres(
  query: Consulta,
  schema: string
): Promise<RetratoDaEstrutura> {
  const colunas = await query<{
    tabela: string; coluna: string; tipo: string; aceita_nulo: string; padrao: string | null;
  }>(
    // `format_type` dá o tipo como o Postgres o escreveria de volta —
    // `character varying(255)`, e não o tipo e o tamanho em colunas separadas.
    // É o que o comparador precisa para dizer "igual".
    `SELECT c.table_name AS tabela, c.column_name AS coluna,
            format_type(a.atttypid, a.atttypmod) AS tipo,
            c.is_nullable AS aceita_nulo, c.column_default AS padrao
       FROM information_schema.columns c
       JOIN pg_class t ON t.relname = c.table_name
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
      WHERE c.table_schema = $1
      ORDER BY c.table_name, c.ordinal_position`,
    [schema]
  );

  // `WITH ORDINALITY` no `unnest` preserva a ORDEM das colunas do índice:
  // `(a, b)` e `(b, a)` são índices diferentes, e sem ele viriam na ordem que o
  // planejador quisesse.
  const indices = await query<{
    tabela: string; indice: string; coluna: string; unico: boolean; posicao: number;
  }>(
    `SELECT t.relname AS tabela, i.relname AS indice, a.attname AS coluna,
            ix.indisunique AS unico, k.ord AS posicao
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = $1
      ORDER BY t.relname, i.relname, k.ord`,
    [schema]
  );

  const porTabela = new Map<string, ColunaDaEstrutura[]>();
  for (const c of colunas) {
    const lista = porTabela.get(c.tabela) ?? [];
    lista.push({
      nome: c.coluna,
      tipo: c.tipo,
      aceitaNulo: c.aceita_nulo === 'YES',
      padrao: c.padrao,
    });
    porTabela.set(c.tabela, lista);
  }

  const indicesPorTabela = new Map<string, Map<string, IndiceDaEstrutura>>();
  for (const i of indices) {
    const daTabela = indicesPorTabela.get(i.tabela) ?? new Map();
    const atual = daTabela.get(i.indice);
    daTabela.set(i.indice, {
      nome: i.indice,
      colunas: [...(atual?.colunas ?? []), i.coluna],
      unico: i.unico === true,
    });
    indicesPorTabela.set(i.tabela, daTabela);
  }

  const tabelas: TabelaDaEstrutura[] = [...porTabela.entries()].map(([nome, cols]) => ({
    nome,
    colunas: cols,
    indices: [...(indicesPorTabela.get(nome)?.values() ?? [])],
  }));

  return { banco: schema, tabelas };
}
