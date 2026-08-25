// `RemoteShell` sobre o `ssh2` (spec 054).
//
// É o contrato que a spec 005 declarou para o terminal e que ninguém tinha
// implementado. A conexão já está aberta e autenticada — abrir um canal nela
// não custa nem senha nem processo local.
import type { Client } from 'ssh2';
import type { RemoteShell, ShellChannel, ShellSize } from '../types';

/**
 * O tipo de terminal anunciado ao servidor.
 *
 * `xterm-256color` porque é o que o xterm.js da IDE realmente fala. Anunciar
 * `dumb` ou `vt100` faria o servidor mandar saída sem cor e sem movimento de
 * cursor — e programas de tela cheia, como o `htop`, sairiam quebrados.
 */
const TERM = 'xterm-256color';

export function criarShellRemoto(client: Client, comandoInicial?: string): RemoteShell {
  return {
    open: (size: ShellSize) =>
      new Promise<ShellChannel>((resolver, rejeitar) => {
        client.shell(
          { term: TERM, cols: size.cols, rows: size.rows },
          (erro, stream) => {
            if (erro !== undefined && erro !== null) {
              rejeitar(erro);
              return;
            }

            // O "Shell" do formulário (seção Avançado): um comando rodado
            // assim que o terminal abre. Vai como se tivesse sido digitado,
            // que é o que a ferramenta de referência faz — assim o usuário vê
            // o que rodou, em vez de aparecer já dentro de algo.
            if (comandoInicial !== undefined && comandoInicial !== '') {
              stream.write(`${comandoInicial}\n`);
            }

            resolver({
              write: (dados) => stream.write(dados),
              // `setWindow` pede altura e largura em PIXELS além de linhas e
              // colunas. Zero é o valor que diz "não sei" — e é a verdade: o
              // navegador não conta pixels de terminal para nós.
              resize: ({ cols, rows }) => stream.setWindow(rows, cols, 0, 0),
              onData: (ouvinte) => {
                stream.on('data', (d: Buffer) => ouvinte(d.toString('utf8')));
                // O `stderr` do canal também é tela: num terminal os dois
                // fluxos se misturam, e separá-los aqui esconderia erro.
                stream.stderr.on('data', (d: Buffer) => ouvinte(d.toString('utf8')));
              },
              onClose: (ouvinte) => {
                stream.on('close', (code: number | null) => ouvinte(code ?? null));
              },
              close: () => stream.end(),
            });
          }
        );
      }),
  };
}
