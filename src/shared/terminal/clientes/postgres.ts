// Cliente de linha de comando do PostgreSQL.
//
// A senha vai num arquivo no formato `.pgpass`, apontado por `PGPASSFILE`.
//
// Por que não `PGPASSWORD`: o ambiente de um processo é legível em
// `/proc/<pid>/environ`, e a própria documentação do PostgreSQL desaconselha a
// variável por isso. `PGPASSFILE` carrega só o caminho — e o arquivo é `600`.
//
// Por que não a URL de conexão (`postgres://user:senha@host/db`): ela iria para
// `argv`, que é exatamente o que esta spec existe para evitar.
import type { ClienteDeLinhaDeComando } from '../comando';
import { texto } from '../comando';

/** No `.pgpass`, `:` e `\` dentro de um campo precisam de barra invertida. */
function escapar(valor: string): string {
  return valor.replace(/([\\:])/g, '\\$1');
}

export const CLI_POSTGRES: ClienteDeLinhaDeComando = {
  exec: 'psql',
  campoDeSenha: 'password',

  montarArgs({ fields, readOnly }) {
    const args: string[] = [];
    const par = (flag: string, valor: string): void => {
      if (valor !== '') args.push(flag, valor);
    };
    par('-h', texto(fields, 'host'));
    par('-p', texto(fields, 'port'));
    par('-U', texto(fields, 'user'));

    const banco = texto(fields, 'database');
    if (banco !== '') args.push('-d', banco);

    // `readOnly` não vira argumento aqui: vai em PGOPTIONS, porque `psql` não
    // tem equivalente ao `--init-command` do MySQL.
    void readOnly;
    return args;
  },

  montarEnv({ readOnly, arquivoDeCredencial }) {
    const env: Record<string, string> = {};
    if (arquivoDeCredencial !== null) env.PGPASSFILE = arquivoDeCredencial;
    if (readOnly) {
      // Vai para o servidor no handshake — a restrição é dele, não do cliente.
      env.PGOPTIONS = '-c default_transaction_read_only=on';
    }
    return env;
  },

  montarCredencial(senha) {
    // `host:porta:banco:usuário:senha`. Os curingas evitam ter que repetir aqui
    // o que já está nos argumentos — e um arquivo de uma linha só, com prazo de
    // vida de uma sessão, não ganha nada em ser específico.
    return `*:*:*:*:${escapar(senha)}\n`;
  },
};
