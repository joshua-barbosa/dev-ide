// O `ssh2` embrulhado em promessas (spec 052).
//
// O `ssh2` é uma API de eventos e callbacks, e o resto do projeto fala
// `async/await`. Concentrar a tradução num lugar só evita que cada chamada
// invente o seu jeito de esperar — e é aqui que a captura da depuração vive,
// que é o que faz o erro de negociação poder dizer o que o servidor ofereceu
// (D21).
import * as fs from 'fs';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { explicarFalhaDeHandshake } from './ssh-diagnostico';
import type { ConfigSsh } from './ssh-campos';

/**
 * Quantas linhas de depuração guardar.
 *
 * O aperto de mão acontece nas primeiras dezenas; guardar tudo de uma sessão
 * longa seria segurar memória para sempre por causa de um erro que, se
 * acontecer, acontece no começo.
 */
const LINHAS_DE_DEPURACAO = 80;

export interface ResultadoDeComando {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

export interface ClienteSsh {
  /** Roda um comando e junta a saída. Para comando curto — não é o terminal. */
  executar(comando: string, limiteDeBytes?: number): Promise<ResultadoDeComando>;
  /** O canal SFTP, aberto uma vez e reaproveitado. */
  sftp(): Promise<SFTPWrapper>;
  bruto(): Client;
  aoFechar(listener: (motivo: string) => void): void;
  fechar(): void;
}

/** Monta o que o `ssh2` espera, a partir do que o formulário guardou. */
function opcoesDeConexao(config: ConfigSsh): ConnectConfig {
  const base: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    readyTimeout: config.timeoutMs,
    // Sem isto uma rede que cai deixa a sessão pendurada até o SO desistir, e a
    // árvore fica girando sem nunca falhar.
    keepaliveInterval: 20_000,
    keepaliveCountMax: 3,
  };

  const algoritmos: Record<string, readonly string[]> = {};
  if (config.algoritmos.cipher !== undefined) algoritmos.cipher = config.algoritmos.cipher;
  if (config.algoritmos.kex !== undefined) algoritmos.kex = config.algoritmos.kex;
  if (config.algoritmos.serverHostKey !== undefined) {
    algoritmos.serverHostKey = config.algoritmos.serverHostKey;
  }
  const comAlgoritmos =
    Object.keys(algoritmos).length === 0
      ? base
      : { ...base, algorithms: algoritmos as ConnectConfig['algorithms'] };

  // A chave é lida do disco AQUI, no instante de conectar, e não guardada em
  // lugar nenhum: o cofre guarda o caminho, e o conteúdo só existe durante a
  // chamada. Ler antes seria segurar material secreto em memória à toa.
  const chave =
    config.privateKeyPath === undefined ? undefined : fs.readFileSync(config.privateKeyPath);

  switch (config.auth) {
    case 'password':
      return { ...comAlgoritmos, password: config.password };
    case 'key':
      return { ...comAlgoritmos, privateKey: chave, passphrase: config.passphrase };
    case 'agent':
      return { ...comAlgoritmos, agent: config.agentPath ?? process.env.SSH_AUTH_SOCK };
    case 'auto':
      // Manda o que houver e deixa o servidor escolher — é o que `auto`
      // significa na ferramenta de referência.
      return {
        ...comAlgoritmos,
        password: config.password,
        privateKey: chave,
        passphrase: config.passphrase,
        agent: process.env.SSH_AUTH_SOCK,
      };
  }
}

export async function conectar(config: ConfigSsh): Promise<ClienteSsh> {
  const client = new Client();
  const depuracao: string[] = [];
  let sftpAberto: Promise<SFTPWrapper> | null = null;
  const ouvintesDeFecho: ((motivo: string) => void)[] = [];
  let pronto = false;

  const opcoes: ConnectConfig = {
    ...opcoesDeConexao(config),
    debug: (linha: string) => {
      depuracao.push(linha);
      if (depuracao.length > LINHAS_DE_DEPURACAO) depuracao.shift();
    },
  };

  await new Promise<void>((resolver, rejeitar) => {
    client.once('ready', () => {
      pronto = true;
      resolver();
    });
    client.once('error', (erro: Error) => {
      // Depois de pronto, erro não é falha de conexão: é a sessão morrendo, e
      // quem trata isso é `aoFechar`.
      if (pronto) return;
      const explicado = explicarFalhaDeHandshake(erro.message, depuracao);
      rejeitar(new Error(explicado ?? erro.message));
    });
    try {
      client.connect(opcoes);
    } catch (e) {
      rejeitar(e instanceof Error ? e : new Error(String(e)));
    }
  });

  const avisarFecho = (motivo: string): void => {
    for (const l of ouvintesDeFecho) l(motivo);
  };
  client.on('close', () => avisarFecho('a conexão SSH foi encerrada'));
  client.on('error', (erro: Error) => {
    if (pronto) avisarFecho(erro.message);
  });

  return {
    executar: (comando, limiteDeBytes = 1_000_000) =>
      new Promise<ResultadoDeComando>((resolver, rejeitar) => {
        client.exec(comando, (erro, canal) => {
          if (erro !== undefined && erro !== null) {
            rejeitar(erro);
            return;
          }
          let stdout = '';
          let stderr = '';
          // Teto de bytes: um `cat` num arquivo de log de 2 GB não pode virar
          // uma string de 2 GB no processo da IDE.
          const juntar = (atual: string, pedaco: Buffer): string =>
            atual.length >= limiteDeBytes ? atual : atual + pedaco.toString('utf8');

          canal.on('data', (d: Buffer) => {
            stdout = juntar(stdout, d);
          });
          canal.stderr.on('data', (d: Buffer) => {
            stderr = juntar(stderr, d);
          });
          canal.on('close', (code: number | null) => resolver({ stdout, stderr, code }));
        });
      }),

    sftp: () => {
      // Um canal SFTP por sessão, e não por chamada: abrir um canal custa uma
      // ida ao servidor, e a árvore faz uma listagem por pasta expandida.
      sftpAberto ??= new Promise<SFTPWrapper>((resolver, rejeitar) => {
        client.sftp((erro, wrapper) => {
          if (erro !== undefined && erro !== null) {
            // Falhou: esquece a promessa para a próxima tentativa não herdar o
            // erro para sempre.
            sftpAberto = null;
            rejeitar(erro);
            return;
          }
          resolver(wrapper);
        });
      });
      return sftpAberto;
    },

    bruto: () => client,
    aoFechar: (listener) => ouvintesDeFecho.push(listener),
    fechar: () => client.end(),
  };
}
