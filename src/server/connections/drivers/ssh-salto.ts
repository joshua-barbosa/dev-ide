// Conectar ATRAVÉS de um bastion — o `ssh -J` do OpenSSH (T078).
//
// Uma máquina que se alcança da internet e que alcança as que não se alcançam.
// É como quase toda rede séria expõe o que está atrás dela, e sem isto a IDE só
// serve para o que já está exposto.
//
// **O mecanismo é `forwardOut`.** Abre-se uma sessão SSH com o bastion e pede-se
// a ele um canal TCP até o destino; esse canal vira o "socket" da segunda
// sessão. O tráfego da segunda passa cifrado dentro da primeira, e o bastion vê
// bytes que não sabe ler — é a mesma garantia do `ProxyJump`.
//
// A alternativa seria abrir uma porta local e mandar o `ssh2` conectar nela.
// Seria mais simples de escrever e pior: a porta ficaria acessível a qualquer
// processo da máquina enquanto a conexão existisse.
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import type { ConfigDeSalto } from './ssh-campos';

/** O que o salto devolve: o canal pronto e como desmontá-lo. */
export interface SaltoAberto {
  /**
   * O canal TCP até o destino, para entrar como `sock` na segunda conexão.
   *
   * `ClientChannel` é um `Duplex` do Node, que é o que o `ssh2` aceita ali —
   * declarar como `ReadableStream & WritableStream` seria mais genérico e não
   * casaria com o tipo dele.
   */
  readonly sock: ClientChannel;
  /** Encerra a sessão com o bastion. */
  fechar(): void;
}

function opcoesDoBastion(salto: ConfigDeSalto, timeoutMs: number): ConnectConfig {
  // A chave é lida no instante de conectar, e não guardada: o cofre guarda o
  // caminho, e o conteúdo só existe durante a chamada. Mesma regra do destino.
  const chave =
    salto.privateKeyPath === undefined ? undefined : fs.readFileSync(salto.privateKeyPath);
  return {
    host: salto.host,
    port: salto.port,
    username: salto.username,
    readyTimeout: timeoutMs,
    keepaliveInterval: 20_000,
    keepaliveCountMax: 3,
    // Manda o que houver: quem preenche um bastion raramente sabe de cor se ele
    // aceita senha ou chave, e tentar os dois é o que o `ssh` faz.
    ...(salto.password === undefined ? {} : { password: salto.password }),
    ...(chave === undefined ? {} : { privateKey: chave, passphrase: salto.passphrase }),
    ...(process.env.SSH_AUTH_SOCK === undefined ? {} : { agent: process.env.SSH_AUTH_SOCK }),
  };
}

/**
 * Abre o canal até `destino` passando pelo bastion.
 *
 * Os erros dizem QUAL das duas pontas falhou. Sem isso, "conexão recusada" com
 * um bastion no meio manda a pessoa conferir o servidor errado — e é o tipo de
 * confusão que custa uma tarde.
 */
export async function abrirSalto(
  salto: ConfigDeSalto,
  destino: { readonly host: string; readonly port: number },
  timeoutMs: number
): Promise<SaltoAberto> {
  const bastion = new Client();

  await new Promise<void>((resolver, rejeitar) => {
    bastion.once('ready', resolver);
    bastion.once('error', (erro: Error) => {
      rejeitar(new Error(`Falha ao conectar no bastion ${salto.host}: ${erro.message}`));
    });
    try {
      bastion.connect(opcoesDoBastion(salto, timeoutMs));
    } catch (e) {
      rejeitar(new Error(`Falha ao conectar no bastion ${salto.host}: ${(e as Error).message}`));
    }
  });

  const sock = await new Promise<ClientChannel>(
    (resolver, rejeitar) => {
      // `127.0.0.1:0` como origem: é o endereço que o bastion registra como
      // quem pediu. Porta 0 = ele escolhe, que é o que o OpenSSH faz.
      bastion.forwardOut('127.0.0.1', 0, destino.host, destino.port, (erro, canal) => {
        if (erro !== undefined && erro !== null) {
          bastion.end();
          rejeitar(
            new Error(
              `O bastion ${salto.host} conectou, mas não alcançou ` +
                `${destino.host}:${destino.port} — ${erro.message}`
            )
          );
          return;
        }
        resolver(canal);
      });
    }
  );

  return {
    sock,
    // Fechar o bastion derruba o canal junto, e é o que se quer: a sessão de
    // dentro morreu, e manter a de fora viva seria vazar uma conexão por
    // desconexão.
    fechar: () => bastion.end(),
  };
}
