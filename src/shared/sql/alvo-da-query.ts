// De qual tabela veio este `SELECT`? (T060 · spec 044)
//
// Na spec 044 eu escrevi que editar em SQL livre ficava de fora porque "a IDE
// não sabe qual tabela é". Verdade parcial: em MUITO SELECT ela dá para saber —
// `select * from alunos where id = 1` é inequívoco. O que não dá é adivinhar em
// `JOIN`, `GROUP BY`, subconsulta ou coluna calculada.
//
// A regra deste módulo: **na dúvida, diz que não sabe.** Um falso positivo aqui
// não desalinha uma coluna, monta um `UPDATE` contra a tabela errada.

export interface AlvoDaQuery {
  /** Nome como aparece no SQL, sem citação. Pode vir qualificado. */
  readonly tabela: string;
  /** O schema, quando o SQL qualificou (`banco.tabela`). */
  readonly schema: string | null;
}

/** O que impede a IDE de apontar UMA tabela — cada um por um motivo próprio. */
const IMPEDITIVOS: readonly (readonly [RegExp, string])[] = [
  [/\bjoin\b/i, 'a consulta junta mais de uma tabela'],
  [/\bunion\b/i, 'a consulta une resultados de origens diferentes'],
  [/\bgroup\s+by\b/i, 'a consulta agrupa linhas, e uma linha do resultado não é uma linha da tabela'],
  [/\bdistinct\b/i, 'a consulta descarta repetidas, e não dá para saber qual linha ficou'],
  [/\bhaving\b/i, 'a consulta filtra grupos'],
  // Vírgula entre o `FROM` e o próximo bloco é `JOIN` da forma antiga.
  [/\bfrom\b[^;]*?,[^;]*?(\bwhere\b|\border\b|\blimit\b|$)/i, 'a consulta lista mais de uma tabela no FROM'],
];

/**
 * Tira comentários e o texto entre aspas SIMPLES.
 *
 * Aspas duplas NÃO são tocadas: no Postgres elas são identificador, e apagá-las
 * destruía o nome da tabela em `select * from "public"."logs"` — o teste pegou.
 *
 * O preço: um MySQL com `sql_mode` frouxo pode usar `"texto"` como string, e
 * uma palavra como `join` dentro dela seria lida como cláusula. A consequência
 * é a IDE NÃO oferecer edição numa consulta que daria — o lado seguro do erro,
 * e o único aceitável aqui.
 */
function semRuido(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

function semCitacao(nome: string): string {
  return nome.replace(/^[`"[]/, '').replace(/[`"\]]$/, '');
}

/**
 * A tabela de um `SELECT` simples, ou `null` com o motivo.
 *
 * Devolve `null` para tudo que não for um `SELECT` de uma tabela só: é a
 * diferença entre "não ofereço edição" e "ofereço edição da linha errada".
 */
export function alvoDaQuery(sql: string): {
  readonly alvo: AlvoDaQuery | null;
  readonly motivo: string | null;
} {
  const limpo = semRuido(sql).replace(/\s+/g, ' ').trim();

  if (!/^select\b/i.test(limpo)) {
    return { alvo: null, motivo: 'isto não é um SELECT' };
  }
  // Subconsulta: um `select` dentro do outro. O `FROM` externo pode ser uma
  // tabela, mas as colunas do resultado podem não ser as dela.
  if (/\(\s*select\b/i.test(limpo)) {
    return { alvo: null, motivo: 'a consulta tem uma subconsulta' };
  }
  for (const [padrao, motivo] of IMPEDITIVOS) {
    if (padrao.test(limpo)) return { alvo: null, motivo };
  }

  // `FROM` seguido de um nome, opcionalmente qualificado e citado. Nada de
  // apelido: `from alunos a` também serve, mas o apelido não muda a tabela.
  const m = /\bfrom\s+([`"[]?[\w$]+[`"\]]?)(?:\s*\.\s*([`"[]?[\w$]+[`"\]]?))?/i.exec(limpo);
  if (m === null) return { alvo: null, motivo: 'não achei um FROM com uma tabela' };

  const primeiro = semCitacao(m[1] ?? '');
  const segundo = m[2] === undefined ? null : semCitacao(m[2]);

  return {
    alvo: segundo === null
      ? { tabela: primeiro, schema: null }
      : { tabela: segundo, schema: primeiro },
    motivo: null,
  };
}

/**
 * As colunas do resultado são as colunas da TABELA?
 *
 * Só é seguro editar quando são. `select id, nome from alunos` é editável;
 * `select count(*) from alunos` não é, e a lista de colunas é o que denuncia —
 * sem precisar entender a expressão.
 */
export function colunasSaoDaTabela(
  doResultado: readonly string[],
  daTabela: readonly string[]
): boolean {
  if (doResultado.length === 0) return false;
  const reais = new Set(daTabela);
  return doResultado.every((c) => reais.has(c));
}
