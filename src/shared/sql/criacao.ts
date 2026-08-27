// Quando o `CREATE` da árvore pode ser executado (T113, spec 069).
//
// O `+` de uma categoria passou a EXECUTAR, e não só a abrir o esqueleto num
// editor. `CREATE` não é `DROP`: criar um objeto novo não apaga nada e se
// desfaz apagando o que acabou de nascer. A regra da spec 046 — gerar e abrir —
// continua valendo para o que reescreve ou apaga.
//
// A parte que precisa de teste não é o caminho feliz: é a RECUSA. Um botão que
// só falha depois de apertado é a interface que ele já reclamou no `Security`.

/**
 * `DELIMITER` é comando do CLIENTE `mysql`, não do servidor.
 *
 * Mandá-lo pela conexão dá erro de sintaxe, e o quebrador de statements ainda
 * parte DENTRO do `BEGIN…END` — que é o T052, do lote B, ainda aberto. Só conta
 * quando ABRE a linha: uma coluna chamada `delimiter` ou um comentário que
 * mencione a palavra não podem tirar o botão.
 */
const DELIMITER_NA_LINHA = /^[ \t]*DELIMITER\b/im;

/** Linha que não é comentário nem espaço — é o que prova que há comando. */
const TEM_COMANDO = /^[ \t]*(?!--|#|\/\*)\S/m;

/**
 * O que esta janela NÃO executa.
 *
 * Ela se chama "Criar em X" e o campo é livre — nada impede digitar um `DROP`
 * ali. A regra da spec 046 continua valendo: o que **reescreve ou apaga** é
 * gerado e ABERTO, com o `▷ Run` sob o olho de quem vai rodar. Um `ALTER` numa
 * tabela de 100 milhões de linhas tranca a tabela por minutos, e isso não pode
 * sair de um clique numa janela cujo título diz "criar".
 *
 * `Abrir no editor` continua ao lado, e é por onde essas passam.
 */
const DESTRUTIVOS = /^[ \t]*(DROP|TRUNCATE|DELETE|ALTER|UPDATE|RENAME)\b/im;

/**
 * Por que este esqueleto NÃO pode ser executado, ou `null` se pode.
 *
 * Texto e não booleano, pela mesma razão de sempre nesta IDE: "não responde ao
 * clique" é a pior interface possível.
 */
export function motivoParaNaoExecutar(sql: string, somenteLeitura: boolean): string | null {
  if (somenteLeitura) {
    return 'Esta conexão está marcada como somente-leitura. Abra no editor para revisar.';
  }
  if (!TEM_COMANDO.test(sql)) return 'Não há comando para executar.';
  if (DELIMITER_NA_LINHA.test(sql)) {
    return (
      'Este esqueleto usa DELIMITER, que é comando do cliente mysql e não do servidor. ' +
      'Abra no editor e rode por lá.'
    );
  }
  const destrutivo = DESTRUTIVOS.exec(sql);
  if (destrutivo !== null) {
    return (
      `Esta janela cria; ${destrutivo[1].toUpperCase()} reescreve ou apaga. ` +
      'Abra no editor e rode com o ▷ Run, para o comando passar pelo seu olho antes.'
    );
  }
  return null;
}
