// Qual banco uma conexão PostgreSQL abre quando ninguém escolheu um.
//
// A regra existia em UM lugar — o `connect` do driver — e faltava no outro: o
// cliente de linha de comando. Com o campo "Banco principal" vazio, a árvore
// abria em `postgres` e o terminal não passava `-d` nenhum; o `psql` então cai
// no banco com o NOME DO USUÁRIO, e o servidor responde
// `FATAL: database "<usuário>" does not exist`.
//
// Foi o que ele viu, e a mensagem esconde bem a causa: parece problema de
// permissão ou de rede, e é uma opção que não foi montada.
//
// Aqui a decisão é uma só, e os dois lados a importam.

/**
 * O banco de manutenção que todo cluster PostgreSQL tem.
 *
 * É por ele que se entra para descobrir os outros: não há consulta
 * cross-database no Postgres, então a conexão inicial precisa cair em algo que
 * exista com certeza.
 */
export const BANCO_INICIAL_POSTGRES = 'postgres';

/** O banco escolhido, ou o de manutenção quando o campo está vazio. */
export function bancoInicialDoPostgres(escolhido: unknown): string {
  const texto = typeof escolhido === 'string' ? escolhido.trim() : '';
  return texto === '' ? BANCO_INICIAL_POSTGRES : texto;
}
