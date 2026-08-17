// Cliente de linha de comando do MySQL.
//
// A senha vai por `--defaults-extra-file`, e não por `-p`. Duas razões:
//
// - `-p<senha>` coloca o segredo em `argv`, visível em `ps` para qualquer
//   usuário da máquina — o próprio cliente avisa disso ao iniciar.
// - `--defaults-EXTRA-file` (e não `--defaults-file`) porque o segundo
//   SUBSTITUIRIA o `~/.my.cnf` do usuário, mudando comportamento que ele já
//   conhece. O "extra" soma ao que já existe.
import type { ClienteDeLinhaDeComando } from '../comando';
import { texto } from '../comando';

export const CLI_MYSQL: ClienteDeLinhaDeComando = {
  exec: 'mysql',
  campoDeSenha: 'password',

  montarArgs({ fields, readOnly, arquivoDeCredencial }) {
    const args: string[] = [];

    // Precisa vir ANTES de tudo: o cliente só aceita opções de arquivo de
    // configuração como primeiro argumento.
    if (arquivoDeCredencial !== null) args.push(`--defaults-extra-file=${arquivoDeCredencial}`);

    const par = (flag: string, valor: string): void => {
      if (valor !== '') args.push(flag, valor);
    };
    par('-h', texto(fields, 'host'));
    par('-P', texto(fields, 'port'));
    par('-u', texto(fields, 'user'));

    const socket = texto(fields, 'socket_path');
    if (socket !== '') args.push('-S', socket);

    if (readOnly) {
      // Imposto pelo SERVIDOR, como manda o Artigo II — não é filtro no texto
      // do que o usuário digitar depois.
      args.push('--init-command=SET SESSION TRANSACTION READ ONLY');
    }

    const banco = texto(fields, 'main_database');
    if (banco !== '') args.push(banco);

    return args;
  },

  montarCredencial(senha) {
    // Formato de option file. Sem aspas: o MySQL lê o valor até o fim da linha,
    // então senha com espaço ou aspas funciona sem escape nenhum.
    return `[client]\npassword=${senha}\n`;
  },
};
