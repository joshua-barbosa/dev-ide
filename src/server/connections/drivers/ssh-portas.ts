// `PortForwarding` sobre `ssh2` (spec 059).
//
// A última das capacidades da spec 005. Um encaminhamento é um servidor TCP
// local que, a cada conexão, abre um canal na sessão SSH e liga os dois canos:
// quem fala com `127.0.0.1:3307` está falando com `10.0.0.5:3306` do outro
// lado, sem que nada disso precise estar exposto na rede.
//
// **É o mesmo motor que faz um banco atrás de bastion funcionar.** Um MySQL que
// só existe dentro da rede do servidor vira um MySQL em `127.0.0.1` para o
// driver da spec 006 — que não precisa saber de nada.
import * as net from 'net';
import type { Client } from 'ssh2';
import type { PortForward, PortForwarding } from '../types';

/**
 * Só em `127.0.0.1`.
 *
 * Escutar em `0.0.0.0` publicaria na rede local um caminho para dentro do
 * servidor remoto — e quem abre um túnel quer alcançar o outro lado, não abrir
 * a própria máquina. É o mesmo endurecimento que o servidor da IDE já tem.
 */
const SO_LOOPBACK = '127.0.0.1';

/** Teto de túneis por conexão. Cada um segura uma porta e um servidor TCP. */
export const MAX_TUNEIS = 20;

interface TunelVivo extends PortForward {
  readonly servidor: net.Server;
}

export function criarEncaminhamento(client: Client): PortForwarding {
  const vivos = new Map<string, TunelVivo>();
  let proximo = 0;

  const fechar = (id: string): void => {
    const tunel = vivos.get(id);
    if (tunel === undefined) return;
    vivos.delete(id);
    tunel.servidor.close();
  };

  return {
    list: async () =>
      [...vivos.values()].map(({ id, localPort, remoteHost, remotePort }) => ({
        id,
        localPort,
        remoteHost,
        remotePort,
      })),

    open: (remoteHost, remotePort, localPort) =>
      new Promise<PortForward>((resolver, rejeitar) => {
        if (vivos.size >= MAX_TUNEIS) {
          rejeitar(new Error(`Limite de ${MAX_TUNEIS} encaminhamentos nesta conexão.`));
          return;
        }

        const servidor = net.createServer((local) => {
          client.forwardOut(
            SO_LOOPBACK,
            // A porta de origem é informativa no protocolo, e o `ssh2` a exige.
            // Zero significa "não importa", que é a verdade aqui.
            0,
            remoteHost,
            remotePort,
            (erro, canal) => {
              if (erro !== undefined && erro !== null) {
                // Fechar a ponta local avisa quem tentou conectar; deixá-la
                // aberta faria o cliente esperar para sempre.
                local.destroy(erro);
                return;
              }
              local.pipe(canal).pipe(local);
              // Sem isto, um lado que fecha deixa o outro pendurado segurando
              // um canal do SSH.
              canal.on('close', () => local.destroy());
              local.on('close', () => canal.end());
              local.on('error', () => canal.end());
            }
          );
        });

        servidor.on('error', (erro) => rejeitar(erro));

        // `localPort` ausente ou zero: o SO escolhe uma porta livre, e a IDE
        // devolve qual foi. É melhor que sortear e torcer.
        servidor.listen(localPort ?? 0, SO_LOOPBACK, () => {
          const endereco = servidor.address();
          const porta = typeof endereco === 'object' && endereco !== null ? endereco.port : 0;
          const id = `pf${(proximo += 1)}`;
          const tunel: TunelVivo = { id, localPort: porta, remoteHost, remotePort, servidor };
          vivos.set(id, tunel);
          resolver({ id, localPort: porta, remoteHost, remotePort });
        });
      }),

    close: async (id) => fechar(id),
  };
}

/** Derruba tudo — chamado quando a sessão fecha. */
export function fecharTodos(encaminhamento: PortForwarding): Promise<void> {
  return encaminhamento
    .list()
    .then(async (tuneis) => {
      for (const t of tuneis) await encaminhamento.close(t.id);
    })
    .catch(() => undefined);
}
