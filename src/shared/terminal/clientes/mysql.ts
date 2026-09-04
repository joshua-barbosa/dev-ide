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

const CAMPO_DE_BANCO = 'main_database';

export const CLI_MYSQL: ClienteDeLinhaDeComando = {
  exec: 'mysql',
  campoDeSenha: 'password',
  campoDeBanco: CAMPO_DE_BANCO,

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

    const banco = texto(fields, CAMPO_DE_BANCO);
    if (banco !== '') args.push(banco);

    return args;
  },

  montarCredencial(senha) {
    // **Entre aspas, e com escape.** Aqui estava escrito que o MySQL "lê o
    // valor até o fim da linha, então senha com espaço ou aspas funciona sem
    // escape nenhum". É falso, e custou caro: num option file sem aspas o `#`
    // começa um COMENTÁRIO e `\n`, `\t`, `\s` e `\b` são ESCAPES. Uma senha
    // com `#` chegava cortada no primeiro `#`, e uma com `\n` virava duas
    // linhas.
    //
    // O sintoma é traiçoeiro: o driver recebe a senha inteira e a árvore abre
    // normalmente, enquanto o terminal responde "Access denied" — parece
    // permissão do banco, e é o arquivo que foi mal escrito. Foi o que ele viu.
    //
    // Conferido contra o cliente de verdade, com `mysql --print-defaults`:
    // sem aspas, `abc#def` vira `abc`; com aspas, volta inteiro.
    const escapada = senha.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `[client]\npassword="${escapada}"\n`;
  },
};
