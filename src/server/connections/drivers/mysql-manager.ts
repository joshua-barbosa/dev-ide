// A aba `Manager` do MySQL: Dashboard, Log e Structure Sync (T070).
//
// **Tudo aqui é SELECT e SHOW.** Nenhum comando desta pasta altera nada — nem o
// Structure Sync, que gera o SQL e devolve o TEXTO para o usuário rodar quando
// e se quiser. É a restrição que ele pôs no lote inteiro, e ela cabe bem:
// comparar estrutura e aplicar estrutura são gestos diferentes, e juntá-los num
// clique é como esse tipo de ferramenta costuma estragar o dia de alguém.
import { nivelDaLinha } from '../../../shared/sql/manager';
import type {
  ColunaDaEstrutura, IndiceDaEstrutura, LinhaDeLog, MetricaDoBanco,
  RetratoDaEstrutura, TabelaDaEstrutura,
} from '../../../shared/sql/manager';

/**
 * Os números que o Dashboard mostra, escolhidos a dedo.
 *
 * `SHOW GLOBAL STATUS` devolve cerca de **quatrocentas** linhas. Uma lista de
 * quatrocentos números não é painel, é despejo — e esconde justamente o que se
 * queria ver. Estes são os que respondem às perguntas que se faz quando algo
 * está lento.
 */
const STATUS_INTERESSANTES: Readonly<Record<string, { grupo: string; ajuda?: string }>> = {
  Uptime: { grupo: 'Servidor', ajuda: 'Segundos desde que o servidor subiu.' },
  Threads_connected: { grupo: 'Conexões', ajuda: 'Conexões abertas agora.' },
  Threads_running: { grupo: 'Conexões', ajuda: 'Quantas estão executando algo neste instante.' },
  Max_used_connections: { grupo: 'Conexões', ajuda: 'O pico desde que o servidor subiu.' },
  Aborted_connects: { grupo: 'Conexões', ajuda: 'Tentativas que não chegaram a conectar.' },
  Slow_queries: { grupo: 'Consultas', ajuda: 'Passaram do `long_query_time`.' },
  Questions: { grupo: 'Consultas', ajuda: 'Comandos recebidos desde o início.' },
  Innodb_buffer_pool_reads: {
    grupo: 'InnoDB',
    ajuda: 'Leituras que foram ao DISCO — quanto menor, melhor.',
  },
  Innodb_buffer_pool_read_requests: { grupo: 'InnoDB', ajuda: 'Leituras atendidas pela memória.' },
  Innodb_row_lock_waits: { grupo: 'InnoDB', ajuda: 'Esperas por trava de linha.' },
  Open_tables: { grupo: 'Tabelas', ajuda: 'Tabelas abertas no cache.' },
  Table_locks_waited: { grupo: 'Tabelas', ajuda: 'Travas de tabela que precisaram esperar.' },
};

/** As variáveis de configuração que mudam o que se vê acima. */
const VARIAVEIS_INTERESSANTES: Readonly<Record<string, string>> = {
  version: 'Servidor',
  max_connections: 'Conexões',
  long_query_time: 'Consultas',
  innodb_buffer_pool_size: 'InnoDB',
  slow_query_log: 'Consultas',
  log_error: 'Servidor',
};

type Consulta = <T>(sql: string) => Promise<readonly T[]>;

/** Dashboard: os números do servidor (T070). */
export async function metricasDoMysql(query: Consulta): Promise<readonly MetricaDoBanco[]> {
  const status = await query<{ Variable_name: string; Value: string }>('SHOW GLOBAL STATUS');
  const variaveis = await query<{ Variable_name: string; Value: string }>('SHOW GLOBAL VARIABLES');

  const saida: MetricaDoBanco[] = [];
  for (const linha of variaveis) {
    const grupo = VARIAVEIS_INTERESSANTES[linha.Variable_name];
    if (grupo === undefined) continue;
    saida.push({ nome: linha.Variable_name, valor: String(linha.Value), grupo });
  }
  for (const linha of status) {
    const meta = STATUS_INTERESSANTES[linha.Variable_name];
    if (meta === undefined) continue;
    saida.push({
      nome: linha.Variable_name,
      valor: String(linha.Value),
      grupo: meta.grupo,
      ...(meta.ajuda === undefined ? {} : { ajuda: meta.ajuda }),
    });
  }

  // A taxa de acerto do buffer pool é a conta que todo mundo faz de cabeça ao
  // olhar essas duas linhas — fazê-la aqui poupa o erro de dividir ao contrário.
  const pedidos = Number(acharStatus(status, 'Innodb_buffer_pool_read_requests'));
  const disco = Number(acharStatus(status, 'Innodb_buffer_pool_reads'));
  if (Number.isFinite(pedidos) && Number.isFinite(disco) && pedidos > 0) {
    saida.push({
      nome: 'Buffer pool hit rate',
      valor: `${(((pedidos - disco) / pedidos) * 100).toFixed(2)}%`,
      grupo: 'InnoDB',
      ajuda: 'Quanto foi atendido pela memória. Abaixo de 95% costuma doer.',
    });
  }
  return saida;
}

function acharStatus(
  linhas: readonly { Variable_name: string; Value: string }[],
  nome: string
): string | undefined {
  return linhas.find((l) => l.Variable_name === nome)?.Value;
}

/**
 * Log: as últimas linhas, quando o servidor as guarda EM TABELA.
 *
 * `log_output = TABLE` põe o log lento em `mysql.slow_log`; o padrão é
 * `FILE`, e aí o log está num arquivo que só o SSH alcança — e não há SQL que o
 * leia. Devolver `null` nesse caso é dizer a verdade; inventar um painel vazio
 * faria parecer que o servidor não tem erro nenhum.
 */
export async function logDoMysql(
  query: Consulta,
  limite: number
): Promise<readonly LinhaDeLog[] | null> {
  const saida = await query<{ Variable_name: string; Value: string }>(
    "SHOW GLOBAL VARIABLES LIKE 'log_output'"
  );
  const destino = String(saida[0]?.Value ?? '').toUpperCase();
  if (!destino.includes('TABLE')) return null;

  // `LIMIT` interpolado: o valor é conferido como inteiro aqui, e `LIMIT` não
  // aceita parâmetro no MySQL.
  const n = Math.max(1, Math.min(1_000, Math.trunc(limite)));
  const linhas = await query<{ start_time: unknown; sql_text: unknown; user_host: unknown }>(
    `SELECT start_time, user_host, sql_text FROM mysql.slow_log
     ORDER BY start_time DESC LIMIT ${n}`
  );
  return linhas.map((l) => {
    const texto = `${String(l.user_host ?? '')} — ${String(l.sql_text ?? '')}`.trim();
    return {
      quando: l.start_time === null || l.start_time === undefined ? null : String(l.start_time),
      // Toda linha do slow log é, por definição, uma consulta lenta: é aviso, e
      // não "nota". Classificar pelo texto aqui daria `outro` para quase tudo.
      nivel: 'aviso' as const,
      texto: texto === '—' ? String(l.sql_text ?? '') : texto,
    };
  });
}

/** Classifica uma linha vinda de texto solto — usado quando o log é arquivo. */
export function linhaDeLogDeTexto(texto: string): LinhaDeLog {
  // A data costuma abrir a linha: `2026-09-01T12:00:00.123456Z 12 [Note] ...`
  const m = /^(\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?)/.exec(texto);
  return {
    quando: m?.[1] ?? null,
    nivel: nivelDaLinha(texto),
    texto,
  };
}

/**
 * Structure Sync: o retrato de um banco (T070).
 *
 * Uma consulta por conceito, e não uma por tabela: um banco com trezentas
 * tabelas viraria novecentas idas ao servidor, e o retrato demoraria mais que
 * a comparação inteira.
 */
export async function estruturaDoMysql(
  query: Consulta,
  database: string
): Promise<RetratoDaEstrutura> {
  const colunas = await query<{
    TABLE_NAME: string; COLUMN_NAME: string; COLUMN_TYPE: string;
    IS_NULLABLE: string; COLUMN_DEFAULT: string | null;
  }>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ${aspas(database)}
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );

  const indices = await query<{
    TABLE_NAME: string; INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number;
  }>(
    `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ${aspas(database)}
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
  );

  const porTabela = new Map<string, ColunaDaEstrutura[]>();
  for (const c of colunas) {
    const lista = porTabela.get(c.TABLE_NAME) ?? [];
    lista.push({
      nome: c.COLUMN_NAME,
      tipo: c.COLUMN_TYPE,
      aceitaNulo: c.IS_NULLABLE === 'YES',
      padrao: c.COLUMN_DEFAULT,
    });
    porTabela.set(c.TABLE_NAME, lista);
  }

  const indicesPorTabela = new Map<string, Map<string, IndiceDaEstrutura>>();
  for (const i of indices) {
    const daTabela = indicesPorTabela.get(i.TABLE_NAME) ?? new Map();
    const atual = daTabela.get(i.INDEX_NAME);
    daTabela.set(i.INDEX_NAME, {
      nome: i.INDEX_NAME,
      // A ORDEM vem do `SEQ_IN_INDEX` do `ORDER BY`: `(a, b)` e `(b, a)` são
      // índices diferentes, e juntar como conjunto perderia isso.
      colunas: [...(atual?.colunas ?? []), i.COLUMN_NAME],
      unico: Number(i.NON_UNIQUE) === 0,
    });
    indicesPorTabela.set(i.TABLE_NAME, daTabela);
  }

  const tabelas: TabelaDaEstrutura[] = [...porTabela.entries()].map(([nome, cols]) => ({
    nome,
    colunas: cols,
    indices: [...(indicesPorTabela.get(nome)?.values() ?? [])],
  }));

  return { banco: database, tabelas };
}

/**
 * Um literal de texto para o SQL.
 *
 * O nome do banco vem do cliente e entra numa cláusula `WHERE` — sem escape,
 * um nome com aspa fecharia o literal. `information_schema` não aceita
 * parâmetro em todos os drivers, então a citação é feita aqui, e é conferida
 * por teste.
 */
function aspas(valor: string): string {
  return `'${valor.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

export { aspas as aspasParaTeste };
