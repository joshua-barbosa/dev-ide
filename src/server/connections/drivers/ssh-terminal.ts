// `RemoteShell` sobre o `ssh2` (spec 054).
//
// É o contrato que a spec 005 declarou para o terminal e que ninguém tinha
// implementado. A conexão já está aberta e autenticada — abrir um canal nela
// não custa nem senha nem processo local.
import type { Client } from 'ssh2';
import { aspasDeShell } from '../../../shared/remoto/shell';
import type { RemoteShell, ShellChannel, ShellSize } from '../types';

/**
 * O tipo de terminal anunciado ao servidor.
 *
 * `xterm-256color` porque é o que o xterm.js da IDE realmente fala. Anunciar
 * `dumb` ou `vt100` faria o servidor mandar saída sem cor e sem movimento de
 * cursor — e programas de tela cheia, como o `htop`, sairiam quebrados.
 */
const TERM = 'xterm-256color';

/**
 * O que o terminal recebe assim que abre (spec 061).
 *
 * Duas coisas, nesta ordem: **entrar na raiz** da conexão, e o `Shell` que o
 * usuário configurou. Puro para poder ser testado — o resto deste arquivo
 * depende de uma conexão viva.
 *
 * A raiz `/` não gera `cd` nenhum: entrar em `/` num terminal é uma surpresa,
 * não uma conveniência. Quem não configurou raiz cai onde sempre caiu, no home.
 */
export function comandoDeAbertura(raiz: string, shell?: string): string {
  const linhas: string[] = [];
  if (raiz !== '' && raiz !== '/') linhas.push(`cd ${aspasDeShell(raiz)}`);
  if (shell !== undefined && shell.trim() !== '') linhas.push(shell.trim());
  return linhas.join('\n');
}

export function criarShellRemoto(client: Client): RemoteShell {
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

            // **Nada é escrito aqui.** A primeira versão mandava o `cd` no
            // instante em que o canal abria, e o servidor real do usuário
            // mostrou o que acontece: o shell interativo ainda não estava
            // lendo, o TTY ecoou o comando, e ele NÃO executou — o prompt
            // continuou no home, com o texto na tela parecendo que rodou.
            //
            // Quem manda é a tela, depois de ver o prompt aparecer. Essa
            // heurística já existia desde a spec 017, e é a mesma que uma
            // pessoa usa: ela também espera o `$`.

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
