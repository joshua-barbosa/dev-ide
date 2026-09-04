// Cliente de linha de comando do Redis.
//
// A senha vai em `REDISCLI_AUTH`, que é a variável que o próprio `redis-cli`
// documenta para isto. É a MENOS ruim das opções disponíveis, e não uma boa:
//
// - `-a senha` põe o segredo em `argv`, visível a qualquer `ps` da máquina, e o
//   próprio redis-cli imprime um aviso dizendo isso.
// - `--user`/`--pass` têm o mesmo problema.
// - Não existe arquivo de credencial como o `.pgpass` do PostgreSQL.
//
// O ambiente de um processo é legível em `/proc/<pid>/environ` pelo DONO do
// processo — que aqui é o próprio usuário da IDE. Já `argv` é legível por
// qualquer um. Daí a escolha.
import type { ClienteDeLinhaDeComando } from '../comando';
import { texto } from '../comando';

const CAMPO_DE_BANCO = 'database';

export const CLI_REDIS: ClienteDeLinhaDeComando = {
  exec: 'redis-cli',
  campoDeSenha: 'password',
  campoDeBanco: CAMPO_DE_BANCO,
  envDeSenha: 'REDISCLI_AUTH',

  /**
   * Da URL, o ENDEREÇO passa; a credencial, não.
   *
   * Sem isto o terminal em modo URL cairia no `127.0.0.1` do padrão — conectado
   * ao servidor errado, sem dizer nada. A senha continua indo por
   * `REDISCLI_AUTH`.
   */
  sanitizarSegredo(nome, valor) {
    if (nome !== 'url' || valor.trim() === '') return null;
    try {
      const u = new URL(valor.trim());
      u.username = '';
      u.password = '';
      return u.toString();
    } catch {
      // URL que não se lê não vira argumento: melhor o terminal reclamar do
      // endereço faltando do que mandar texto cru para a linha de comando.
      return null;
    }
  },

  montarArgs({ fields }) {
    const url = texto(fields, 'url');
    // No modo URL o endereço já carrega host, porta e banco: repetir os campos
    // faria o `redis-cli` usar dois endereços diferentes na mesma chamada.
    if (texto(fields, 'modo') === 'url' && url !== '') return ['-u', url];

    const args: string[] = [];
    const par = (flag: string, valor: string): void => {
      if (valor !== '') args.push(flag, valor);
    };
    par('-h', texto(fields, 'host'));
    par('-p', texto(fields, 'port'));
    par('-n', texto(fields, CAMPO_DE_BANCO));
    // Usuário VAZIO não vira `--user default`: há servidor que só tem senha, e
    // mandar um usuário que não existe derruba a autenticação. É a mesma regra
    // que o driver já segue.
    par('--user', texto(fields, 'username'));

    const tls = texto(fields, 'tls');
    if (tls === 'true') args.push('--tls');
    return args;
  },

  // Não há arquivo de credencial no redis-cli — a senha vai pelo ambiente.
  montarCredencial() {
    return '';
  },

  montarEnv({ fields }) {
    // A senha NÃO está em `fields` aqui: `montarComando` remove os campos
    // secretos antes de chamar. Quem a injeta é quem monta o ambiente do
    // processo, a partir de `campoDeSenha`.
    void fields;
    return {};
  },
};
