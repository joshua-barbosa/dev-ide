// Transporte do terminal, por WebSocket.
//
// Por que WebSocket e não REST: o fluxo é contínuo e bidirecional, byte a byte.
// Você digita `l`, e o shell ecoa `l` na hora; um `tail -f` cospe linha nova sem
// ninguém pedir. Uma requisição por tecla seria absurdo, e REST não tem como o
// servidor empurrar dados sozinho.
//
// A guarda de origem roda no `upgrade`, ANTES de qualquer PTY nascer. Um
// terminal é execução arbitrária com a conta do usuário — esta porta não pode
// ficar mais frouxa que o resto da API.
import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { SEM_CLIENTE_USE_CANAL } from './abertura';
import type { CanalDeTerminal } from './canal';
import { isAllowedRequest } from '../http/security';
import type { TerminalRegistry } from './registry';
import type { OpcoesDeSessao } from './session';

export const CAMINHO_DO_SOCKET = '/api/terminal';

/** Formato de id aceito do cliente. Estreito de propósito — ver o comentário. */
const ID_VALIDO = /^term-[A-Za-z0-9-]{1,64}$/;

/** Mensagens que o navegador manda. */
type Entrada =
  | {
      readonly tipo: 'abrir';
      readonly opcoes: OpcoesDeSessao;
      /**
       * Id escolhido pelo CLIENTE (spec 023).
       *
       * É o que faz a reconexão existir: o servidor não tem como saber que o
       * socket novo é a mesma aba de antes do F5. O id é validado contra um
       * formato estreito, e o risco de uma aba reatar o terminal de outra é
       * aceitável — é o mesmo usuário, na mesma máquina, num servidor que só
       * escuta em `127.0.0.1` e já executa código arbitrário.
       */
      readonly id?: string;
    }
  | { readonly tipo: 'dados'; readonly dados: string }
  | { readonly tipo: 'tamanho'; readonly cols: number; readonly rows: number }
  /**
   * O usuário fechou o terminal de propósito.
   *
   * É o que distingue "fechei" de "a página caiu". Sem esta mensagem, o
   * servidor não teria como saber, e teria que escolher entre matar tudo (e
   * perder o terminal no F5) ou esperar sempre (e deixar `mysql` vivo por 30 s
   * depois de o usuário mandar fechar). O navegador NÃO roda a limpeza do
   * componente ao recarregar a página — então a mensagem só chega quando o
   * fechamento foi deliberado.
   */
  | { readonly tipo: 'fechar' };

/** Mensagens que o servidor manda. */
type Saida =
  | { readonly tipo: 'dados'; readonly dados: string }
  /** Reatou uma sessão que já existia; o que vem a seguir é o histórico. */
  | { readonly tipo: 'reconectado' }
  | { readonly tipo: 'fim'; readonly exitCode: number; readonly signal?: number }
  | { readonly tipo: 'erro'; readonly mensagem: string };

export interface DepsDoSocket {
  readonly registry: TerminalRegistry;
  /** Monta as opções a partir do que o cliente pediu; valida na fronteira. */
  resolverAbertura(pedido: unknown): Promise<OpcoesDeSessao>;
  /**
   * Abre o terminal de uma conexão que tem canal próprio (SSH, spec 054).
   *
   * Injetado, e não importado, pelo mesmo motivo do `resolverAbertura`: o
   * socket não conhece pool nem driver, e não pode passar a conhecer.
   */
  abrirCanalDaConexao(pedido: unknown): Promise<CanalDeTerminal>;
}

export function montarSocketDeTerminal(
  server: Server,
  { registry, resolverAbertura, abrirCanalDaConexao }: DepsDoSocket
): WebSocketServer {
  // `noServer` para que o `upgrade` passe pela guarda antes de virar WebSocket.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (!url.startsWith(CAMINHO_DO_SOCKET)) return;

    if (!isAllowedRequest({ host: req.headers.host, origin: req.headers.origin })) {
      // Recusa no protocolo HTTP: nenhum PTY chega a existir.
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  /**
   * Um terminal novo: PTY local, ou canal de uma conexão que tem o seu.
   *
   * Quem decide é `resolverAbertura`, que avisa por exceção quando o caminho é
   * o outro — ver `SEM_CLIENTE_USE_CANAL`.
   */
  const abrirNovo = async (id: string, opcoes: unknown): Promise<CanalDeTerminal> => {
    try {
      return registry.abrir(id, await resolverAbertura(opcoes));
    } catch (e) {
      if ((e as Error).message !== SEM_CLIENTE_USE_CANAL) throw e;
      return registry.abrirCanal(id, await abrirCanalDaConexao(opcoes));
    }
  };

  let proximo = 0;
  wss.on('connection', (ws: WebSocket) => {
    let id = `term-${(proximo += 1)}`;
    let aberto = false;

    const enviar = (msg: Saida): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on('message', (bruto) => {
      let msg: Entrada;
      try {
        msg = JSON.parse(String(bruto)) as Entrada;
      } catch {
        enviar({ tipo: 'erro', mensagem: 'Mensagem inválida.' });
        return;
      }

      if (msg.tipo === 'abrir') {
        if (aberto) return;
        aberto = true;
        if (typeof msg.id === 'string' && ID_VALIDO.test(msg.id)) id = msg.id;

        void (async () => {
          try {
            // Reconexão: a sessão sobreviveu ao F5 e estava esperando. Repinta
            // a tela com o histórico antes de qualquer byte novo — terminal vivo
            // com tela em branco é pior que terminal novo.
            const existente = registry.reatar(id);
            const sessao = existente ?? (await abrirNovo(id, msg.opcoes));
            if (existente !== null) {
              enviar({ tipo: 'reconectado' });
              const historico = existente.historico();
              if (historico !== '') enviar({ tipo: 'dados', dados: historico });
            }

            sessao.onData((dados) => enviar({ tipo: 'dados', dados }));
            sessao.onExit(({ exitCode, signal }) => {
              enviar({ tipo: 'fim', exitCode, signal });
              ws.close();
            });
          } catch (e) {
            // Erro de abertura vira mensagem na tela, não aba morta.
            enviar({ tipo: 'erro', mensagem: (e as Error).message });
            ws.close();
          }
        })();
        return;
      }

      if (msg.tipo === 'fechar') {
        registry.fechar(id);
        ws.close();
        return;
      }

      const sessao = registry.obter(id);
      if (sessao === null) return;
      if (msg.tipo === 'dados') sessao.write(msg.dados);
      else if (msg.tipo === 'tamanho') sessao.resize(msg.cols, msg.rows);
    });

    // O socket caiu: SOLTA em vez de matar, e dá um prazo para o navegador
    // voltar. É o que faz o F5 não matar o terminal. Quem fecha a aba pelo
    // botão chama `fechar` direto, e aí o `mysql` morre na hora, sem espera —
    // com o arquivo de credencial junto.
    ws.on('close', () => registry.soltar(id));
  });

  return wss;
}
