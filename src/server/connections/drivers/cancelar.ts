// Parar uma query em andamento (T005 da triagem, spec 013).
//
// Eu tinha escrito na spec 013 que isto "entra junto do grid utilizável". O grid
// veio na spec 041; isto não veio. Ele resgatou da lista dos 114.
//
// O ponto que decide o desenho: **a conexão que está rodando a query está
// ocupada.** Não dá para mandar o cancelamento por ela — o driver está
// esperando a resposta do próprio comando que se quer matar. O cancelamento vai
// por uma conexão NOVA, curta, que abre, manda e fecha.
//
// Por isso cada driver precisa saber o próprio identificador no servidor, e o
// pega no momento em que conecta: perguntar depois exigiria a conexão livre,
// que é exatamente o que não se tem na hora.

export type DialetoDeCancelamento = 'mysql' | 'postgres';

export interface ComandoDeCancelamento {
  readonly sql: string;
  readonly params: readonly (string | number)[];
}

/**
 * O comando que interrompe a query da conexão `id`.
 *
 * MySQL: `KILL QUERY` mata o COMANDO e deixa a conexão viva. `KILL CONNECTION`
 * mataria a sessão inteira, e com ela a transação aberta, os `SET SESSION` de
 * somente-leitura e o `MAX_EXECUTION_TIME` — o usuário pediu para parar uma
 * consulta, não para perder a conexão.
 *
 * Postgres: `pg_cancel_backend` é o equivalente exato. O vizinho perigoso é
 * `pg_terminate_backend`, que derruba a sessão — e está fora daqui de
 * propósito, para não haver como chamá-lo por engano.
 */
export function comandoDeCancelamento(
  dialeto: DialetoDeCancelamento,
  id: number
): ComandoDeCancelamento {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Identificador de conexão inválido: ${JSON.stringify(id)}.`);
  }
  return dialeto === 'mysql'
    ? // Sem parâmetro: o MySQL não aceita `?` no `KILL`. O número foi conferido
      // como inteiro positivo logo acima, então não há texto para injetar.
      { sql: `KILL QUERY ${id}`, params: [] }
    : { sql: 'SELECT pg_cancel_backend($1)', params: [id] };
}

/**
 * O que dizer quando o banco não sabe cancelar.
 *
 * O SQLite é o caso: `node:sqlite` é síncrono, e enquanto a consulta roda o
 * processo inteiro está parado nela — não há segunda conexão possível porque
 * não há segundo instante. Oferecer um botão que não faz nada seria pior que
 * não ter botão, que é a regra desta IDE desde a spec 041.
 */
export const SEM_CANCELAMENTO =
  'Este banco não sabe interromper uma consulta em andamento.';
