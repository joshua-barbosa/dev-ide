// O que se PEDE ao motor para rodar um bloco — a consulta e o código.
//
// Existe porque a mesma decisão estava escrita duas vezes: uma no
// `useExecution` da IDE e outra, à mão, na aba de caderno da extensão. Elas
// divergiram exatamente onde uma cópia sempre diverge — no campo que só um dos
// lados lembrou. A rota `/api/run` exige `mode`, a cópia da extensão não o
// mandava, e todo bloco de JavaScript, Python ou shell morria em "Campo
// obrigatório ausente ou inválido: mode".
//
// Puro de propósito: é a parte da execução que dá para provar sem servidor.

/**
 * Linhas por página do RESULTADO (T056).
 *
 * Era o teto fixo de 500 com um aviso de "resultado cortado" e nada a fazer
 * sobre ele. Continua 500, mas agora é o tamanho da PÁGINA.
 *
 * Aqui, e não no `useExecution`, porque a aba de resultado da EXTENSÃO pagina
 * o mesmo resultado: duas constantes de 500 discordariam no dia em que uma
 * mudasse.
 */
export const LINHAS_POR_PAGINA = 500;

export interface PedidoDeConsulta {
  readonly statement: string;
  readonly database: string;
  readonly rowLimit: number;
  /** Ausente na primeira página: pedir `OFFSET 0` é trabalho à toa no banco. */
  readonly offset?: number;
}

/**
 * A consulta de UMA página do resultado.
 *
 * A página é 1-based porque é o que a barra da grade mostra; a conversão para
 * `offset` mora aqui, e não em cada chamador.
 */
export function pedidoDeConsulta(
  statement: string,
  database: string,
  pagina = 1
): PedidoDeConsulta {
  const numero = Math.max(1, Math.floor(pagina));
  const base = { statement, database, rowLimit: LINHAS_POR_PAGINA };
  return numero === 1 ? base : { ...base, offset: (numero - 1) * LINHAS_POR_PAGINA };
}

export interface PedidoAoRunner {
  readonly mode: 'block';
  readonly language: string;
  readonly code: string;
}

/**
 * Um bloco numa linguagem do runner.
 *
 * `mode: 'block'` não é detalhe: a rota o exige, e é ele que diz ao runner que
 * o que vem é código solto, e não um arquivo do disco.
 */
export function pedidoAoRunner(linguagem: string, codigo: string): PedidoAoRunner {
  return { mode: 'block', language: linguagem, code: codigo };
}
