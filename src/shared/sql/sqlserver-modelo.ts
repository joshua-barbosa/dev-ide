// SQL Server: o que ele faz diferente dos outros três.
//
// É o quarto SQL, e cai na mesma árvore, na mesma grade e na mesma
// `sql-base.ts`. O que muda é pequeno e específico, e é o que mora aqui.

/**
 * A página de um resultado.
 *
 * **`OFFSET … FETCH` EXIGE `ORDER BY`.** Não é preferência do dialeto: o SQL
 * Server recusa a consulta sem ele. E há uma razão boa por trás — sem ordem
 * declarada, "as próximas 50 linhas" não significa nada, porque o banco pode
 * devolvê-las em ordem diferente a cada chamada.
 *
 * Sem coluna para ordenar, usa-se `(SELECT NULL)`, que o próprio SQL Server
 * aceita como "ordem nenhuma, e eu sei disso".
 */
export function paginar(
  sql: string,
  ordem: string | null,
  deslocamento: number,
  quantas: number
): string {
  const porOnde = ordem !== null && ordem.trim() !== '' ? ordem : '(SELECT NULL)';
  const jaTemOrdem = /\border\s+by\b/i.test(sql);
  const comOrdem = jaTemOrdem ? sql : `${sql}\nORDER BY ${porOnde}`;
  return `${comOrdem}\nOFFSET ${Math.max(0, Math.trunc(deslocamento))} ROWS ` +
    `FETCH NEXT ${Math.max(1, Math.trunc(quantas))} ROWS ONLY`;
}

/**
 * Por que o somente-leitura NÃO é imposto pelo servidor aqui.
 *
 * Nos outros três a trava é do banco: `SET SESSION TRANSACTION READ ONLY` no
 * MySQL, `default_transaction_read_only` no PostgreSQL, a flag do arquivo no
 * SQLite. **O SQL Server não tem equivalente de sessão.**
 *
 * `SET TRANSACTION ISOLATION LEVEL SNAPSHOT` muda a leitura, não impede a
 * escrita. `ApplicationIntent=ReadOnly` só roteia para uma réplica legível num
 * grupo de disponibilidade — num servidor comum ele não bloqueia nada.
 *
 * A IDE **não vai filtrar o SQL por texto** para fingir que tem trava: um
 * `EXEC` ou um `sp_executesql` passariam por qualquer filtro, e uma trava que
 * se contorna é pior que trava nenhuma, porque quem confia nela arrisca mais.
 *
 * Então a verdade é dita: a marca fica na conexão, a interface avisa, e quem
 * quer garantia usa um LOGIN somente-leitura no servidor — que é onde essa
 * garantia existe de verdade.
 */
export const PORQUE_SEM_TRAVA =
  'O SQL Server não tem somente-leitura de sessão. `SNAPSHOT` muda a leitura e ' +
  'não impede a escrita, e `ApplicationIntent=ReadOnly` só roteia para réplica ' +
  'num grupo de disponibilidade. A IDE não filtra o SQL por texto para fingir ' +
  'que tem trava — `EXEC` e `sp_executesql` passariam por qualquer filtro. ' +
  'Para garantia de verdade, use um login somente-leitura no servidor.';

/** O `SELECT` de amostra que o duplo clique numa tabela abre. */
export function selectDeAmostra(schema: string, tabela: string, quantas = 100): string {
  const cita = (n: string): string => `[${n.split(']').join(']]')}]`;
  // `TOP`, e não `LIMIT`: é assim que se lê uma amostra em SQL Server, e é o
  // que ele vai reconhecer ao editar a consulta.
  return `SELECT TOP ${Math.max(1, Math.trunc(quantas))} * FROM ${cita(schema)}.${cita(tabela)};`;
}
