// O modo ATIVO do FTP (T084).
//
// O `basic-ftp` declara que não suporta modo ativo; isto entra pelo
// `prepareTransfer`, que é ponto de extensão público dele.
//
// O teste do meio de campo é o que importa: um **servidor de mentira local**
// que fala o protocolo o suficiente para receber o `EPRT`, discar de volta e
// entregar bytes. Nenhum servidor do usuário é tocado — e o caso que mais erra
// (a conta da porta do `PORT`) é conferido por número.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as net from 'node:net';
import { argumentoDoEprt, numerosDoPort, transferenciaAtiva } from '../connections/drivers/ftp-ativo';
import type { FTPContext, FTPResponse } from 'basic-ftp';

test('a porta do PORT é partida em dois bytes', () => {
  // `p1 * 256 + p2` é onde este comando erra, e o erro aparece como
  // "transferência que não começa" — sem nada dizendo por quê.
  assert.equal(numerosDoPort('10.0.0.5', 20_480), '10,0,0,5,80,0');
  assert.equal(numerosDoPort('192.168.1.7', 1), '192,168,1,7,0,1');
  assert.equal(numerosDoPort('127.0.0.1', 65_535), '127,0,0,1,255,255');
});

test('o EPRT distingue IPv4 de IPv6', () => {
  assert.equal(argumentoDoEprt('10.0.0.5', 5000), '|1|10.0.0.5|5000|');
  assert.equal(argumentoDoEprt('::1', 5000), '|2|::1|5000|');
});

/**
 * Um `FTPContext` de mentira: guarda os comandos e finge um socket de controle.
 *
 * `discar` diz o que o "servidor" faz quando recebe o comando de porta — é o
 * que separa o caminho feliz do servidor que nunca liga de volta.
 */
function contextoFalso(opcoes: {
  readonly recusarEprt?: boolean;
  discar?: (porta: number) => void;
}): { ctx: FTPContext; comandos: string[] } {
  const comandos: string[] = [];
  const ctx = {
    socket: { localAddress: '127.0.0.1' },
    dataSocket: undefined as net.Socket | undefined,
    request: async (comando: string): Promise<FTPResponse> => {
      comandos.push(comando);
      if (comando.startsWith('EPRT') && opcoes.recusarEprt === true) {
        throw new Error('500 Command not understood');
      }
      const porta = Number(/\|(\d+)\|$/.exec(comando)?.[1] ?? /,(\d+),(\d+)$/.exec(comando)
        ? Number(/,(\d+),(\d+)$/.exec(comando)?.[1]) * 256 +
          Number(/,(\d+),(\d+)$/.exec(comando)?.[2])
        : 0);
      opcoes.discar?.(porta);
      return { code: 200, message: '200 ok' };
    },
  } as unknown as FTPContext;
  return { ctx, comandos };
}

test('EPRT: o servidor disca de volta e o canal de dados fica pronto', async () => {
  const { ctx, comandos } = contextoFalso({
    discar: (porta) => {
      // O "servidor" conectando de volta — é a inversão que define o modo ativo.
      const s = net.connect(porta, '127.0.0.1');
      s.on('error', () => undefined);
    },
  });

  const resposta = await transferenciaAtiva(ctx);
  assert.equal(resposta.code, 200);
  assert.match(comandos[0] ?? '', /^EPRT \|1\|127\.0\.0\.1\|\d+\|$/);
  assert.ok(ctx.dataSocket !== undefined, 'o canal de dados ficou pronto');
  (ctx.dataSocket as unknown as net.Socket).destroy();
});

test('servidor que recusa EPRT cai no PORT, o de 1985', async () => {
  const { ctx, comandos } = contextoFalso({
    recusarEprt: true,
    discar: (porta) => {
      if (porta === 0) return;
      const s = net.connect(porta, '127.0.0.1');
      s.on('error', () => undefined);
    },
  });

  await transferenciaAtiva(ctx);
  assert.match(comandos[0] ?? '', /^EPRT /);
  assert.match(comandos[1] ?? '', /^PORT 127,0,0,1,\d+,\d+$/);
  (ctx.dataSocket as unknown as net.Socket).destroy();
});

test('servidor que NÃO liga de volta falha dizendo o que conferir', async () => {
  // É o desfecho mais provável numa rede com NAT — e o erro precisa dizer isso,
  // senão a pessoa procura no lugar errado.
  const { ctx } = contextoFalso({ discar: () => undefined });
  await assert.rejects(() => transferenciaAtiva(ctx), /NAT e firewall|modo passivo/);
});

test('sem endereço local não tenta adivinhar', async () => {
  // Uma máquina com três interfaces daria três respostas, e só uma alcança —
  // por isso o endereço vem do socket de controle, ou não vem.
  const ctx = {
    socket: {},
    request: async () => ({ code: 200, message: 'ok' }),
  } as unknown as FTPContext;
  await assert.rejects(() => transferenciaAtiva(ctx), /endereço local/);
});
