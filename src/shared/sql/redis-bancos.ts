// Quais bancos do Redis aparecem na árvore.
//
// Ele pediu em 03/09/2026: *"Também é possível selecionar quais databases estão
// visíveis no Redis. O campo que temos é o que 'default' que mostra."* — ou
// seja, hoje a conexão escolhe UM banco e a árvore não sabe que existem outros.
//
// Um servidor Redis tem 16 bancos por padrão, numerados. Não têm nome, e por
// isso o rótulo é `db0`, `db1`… — o mesmo que o `INFO keyspace` usa, para o que
// se lê aqui bater com o que se lê lá.

/** Quantos bancos o servidor tem, quando ele não diz. */
export const QUANTOS_BANCOS_PADRAO = 16;

export interface BancoDoRedis {
  readonly numero: number;
  readonly rotulo: string;
  /** Quantas chaves, quando o `INFO keyspace` contou. */
  readonly chaves?: number;
}

/**
 * Lê o `INFO keyspace`.
 *
 * O formato é uma linha por banco COM chaves — banco vazio simplesmente não
 * aparece, e é por isso que a ausência aqui significa zero, e não "não sei".
 *
 *     # Keyspace
 *     db0:keys=3,expires=0,avg_ttl=0
 */
export function lerKeyspace(info: string): ReadonlyMap<number, number> {
  const contagens = new Map<number, number>();
  for (const linha of info.split(/\r?\n/)) {
    const m = /^db(\d+):keys=(\d+)/.exec(linha.trim());
    if (m === null) continue;
    contagens.set(Number(m[1]), Number(m[2]));
  }
  return contagens;
}

/**
 * Quantos bancos o servidor tem, a partir do `CONFIG GET databases`.
 *
 * A resposta vem como par `['databases', '16']`. Servidor gerenciado costuma
 * recusar o `CONFIG GET` — e aí vale o padrão, em vez de a árvore ficar vazia.
 */
export function lerQuantosBancos(resposta: unknown): number {
  if (!Array.isArray(resposta)) return QUANTOS_BANCOS_PADRAO;
  const valor = Number(resposta[1]);
  return Number.isInteger(valor) && valor > 0 ? valor : QUANTOS_BANCOS_PADRAO;
}

/**
 * A lista branca de bancos, escrita à mão no cadastro.
 *
 * Aceita vírgula, espaço e quebra de linha, e aceita `db3` além de `3` — o
 * rótulo é o que ele vê na árvore, e exigir que digite diferente do que lê
 * seria uma pegadinha. Vazio significa **todos**.
 */
export function lerListaDeBancos(texto: string | undefined): readonly number[] {
  if (typeof texto !== 'string') return [];
  const numeros: number[] = [];
  for (const pedaco of texto.split(/[\s,;]+/)) {
    const limpo = pedaco.trim().replace(/^db/i, '');
    if (limpo === '') continue;
    const n = Number(limpo);
    if (Number.isInteger(n) && n >= 0 && !numeros.includes(n)) numeros.push(n);
  }
  return numeros;
}

/**
 * Os bancos que a árvore mostra.
 *
 * `todos` desligado devolve só o banco da conexão: é o comportamento de sempre,
 * e continua sendo o padrão.
 *
 * Banco fora do alcance do servidor é descartado em silêncio: pedir `db20` num
 * servidor de 16 não é erro dele, é um cadastro que envelheceu.
 */
export function bancosVisiveis(opcoes: {
  readonly todos: boolean;
  readonly bancoDaConexao: number;
  readonly quantos: number;
  readonly escolhidos: readonly number[];
  readonly contagens?: ReadonlyMap<number, number>;
}): readonly BancoDoRedis[] {
  const { todos, bancoDaConexao, quantos, escolhidos, contagens } = opcoes;
  const numeros = todos
    ? (escolhidos.length > 0
        ? escolhidos.filter((n) => n < quantos)
        : Array.from({ length: quantos }, (_, i) => i))
    : [bancoDaConexao];

  return numeros.map((numero) => {
    const chaves = contagens?.get(numero);
    return {
      numero,
      rotulo: `db${numero}`,
      // Banco que não apareceu no `INFO keyspace` tem zero chaves — a linha só
      // existe quando há chave. Sem `INFO`, não se afirma nada.
      ...(contagens === undefined ? {} : { chaves: chaves ?? 0 }),
    };
  });
}

/**
 * O número do banco a partir do rótulo da árvore.
 *
 * Devolve `null` para o que não for `dbN` — o nó pode ser qualquer outra coisa,
 * e adivinhar zero levaria a varrer o banco errado.
 */
export function bancoDoRotulo(rotulo: string | undefined): number | null {
  if (typeof rotulo !== 'string') return null;
  const m = /^db(\d+)$/.exec(rotulo);
  return m === null ? null : Number(m[1]);
}
