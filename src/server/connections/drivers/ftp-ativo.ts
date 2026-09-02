// Modo ATIVO do FTP (T084).
//
// O `basic-ftp` diz, no README dele: *"Active Mode is not supported"*. Ele
// oferece, porém, um ponto de extensão público — `client.prepareTransfer` —, e
// é por ele que isto entra. Sem trocar a biblioteca, e sem mexer nela.
//
// **A diferença entre os dois modos é quem liga para quem.**
//
// - **Passivo** (`PASV`/`EPSV`, o padrão): o cliente pergunta ao servidor em que
//   porta se conectar, e disca. Funciona atrás de NAT, porque quem sai é você.
// - **Ativo** (`PORT`/`EPRT`): o CLIENTE abre uma porta e manda o servidor
//   discar de volta. É o que servidor antigo às vezes só aceita — e é o que
//   falha em rede com NAT ou firewall, porque a ligação de volta não chega.
//
// Essa ressalva não fica escondida: ela está no `help` do campo, na tela.
import * as net from 'node:net';
import type { FTPContext, FTPResponse } from 'basic-ftp';

/** Quanto se espera o servidor discar de volta antes de desistir. */
const ESPERA_DE_VOLTA_MS = 15_000;

/**
 * Prepara uma transferência em modo ATIVO.
 *
 * A forma é a que o `basic-ftp` espera de uma `TransferStrategy`: recebe o
 * contexto, deixa `ftp.dataSocket` pronto e devolve a última resposta.
 *
 * `EPRT` primeiro, `PORT` depois: o primeiro é o de agora (RFC 2428, funciona
 * em IPv6) e o segundo é o de 1985. Servidor que recusa o moderno costuma ser
 * exatamente o mesmo que só aceita modo ativo — então a queda para o antigo
 * não é zelo excessivo, é o caso de uso.
 */
export async function transferenciaAtiva(ftp: FTPContext): Promise<FTPResponse> {
  const servidor = net.createServer();
  // O endereço que o SERVIDOR vai discar é o nosso, visto por ele — e o jeito
  // certo de descobri-lo é perguntar ao socket de controle, e não ao sistema:
  // uma máquina com três interfaces daria três respostas, e só uma alcança.
  const meuIp = ftp.socket.localAddress;
  if (meuIp === undefined) {
    throw new Error('Não deu para descobrir o endereço local para o modo ativo do FTP.');
  }

  const porta = await new Promise<number>((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    // Porta 0 = o sistema escolhe uma livre. Fixar uma seria escolher por quem
    // usa, e brigar com qualquer outra coisa que já estivesse nela.
    servidor.listen(0, meuIp, () => {
      const endereco = servidor.address();
      if (endereco === null || typeof endereco === 'string') {
        rejeitar(new Error('O sistema não deu uma porta para o modo ativo.'));
        return;
      }
      resolver(endereco.port);
    });
  });

  // A ligação de volta é esperada ANTES de mandar o comando: o servidor pode
  // discar assim que recebe o `EPRT`, e um `accept` registrado depois perderia
  // a conexão.
  const deVolta = new Promise<net.Socket>((resolver, rejeitar) => {
    const relogio = setTimeout(() => {
      servidor.close();
      rejeitar(
        new Error(
          `O servidor não conectou de volta em ${ESPERA_DE_VOLTA_MS / 1000}s. ` +
            'No modo ativo é ele quem disca para a sua máquina: verifique NAT e firewall, ' +
            'ou volte para o modo passivo.'
        )
      );
    }, ESPERA_DE_VOLTA_MS);

    servidor.once('connection', (socket) => {
      clearTimeout(relogio);
      // Fecha o ouvinte, e não o socket: o canal de dados é este que chegou, e
      // deixar a porta aberta aceitaria uma segunda conexão que ninguém pediu.
      servidor.close();
      resolver(socket);
    });
    servidor.once('error', (erro) => {
      clearTimeout(relogio);
      rejeitar(erro);
    });
  });

  const familia = meuIp.includes(':') ? 2 : 1;
  let resposta: FTPResponse;
  try {
    resposta = await ftp.request(`EPRT |${familia}|${meuIp}|${porta}|`);
  } catch {
    // `EPRT` recusado: cai para o `PORT` de 1985, que só existe em IPv4.
    if (familia === 2) {
      servidor.close();
      throw new Error('Este servidor não aceita EPRT, e o modo antigo (PORT) não fala IPv6.');
    }
    // `PORT` escreve o endereço e a porta em seis números decimais: os quatro
    // do IP, e a porta partida em dois bytes.
    const partes = [...meuIp.split('.'), Math.floor(porta / 256), porta % 256];
    resposta = await ftp.request(`PORT ${partes.join(',')}`);
  }

  ftp.dataSocket = await deVolta;
  return resposta;
}

/**
 * Os seis números do comando `PORT`, dado um IP e uma porta.
 *
 * Separado para ser testável: a conta da porta (`p1 * 256 + p2`) é onde este
 * comando erra, e o erro aparece como "transferência que não começa".
 */
export function numerosDoPort(ip: string, porta: number): string {
  return [...ip.split('.'), Math.floor(porta / 256), porta % 256].join(',');
}

/** O argumento do `EPRT`, dado um IP e uma porta. */
export function argumentoDoEprt(ip: string, porta: number): string {
  return `|${ip.includes(':') ? 2 : 1}|${ip}|${porta}|`;
}
