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
import { isAllowedRequest } from '../http/security';
import type { TerminalRegistry } from './registry';
import type { OpcoesDeSessao } from './session';

export const CAMINHO_DO_SOCKET = '/api/terminal';

/** Mensagens que o navegador manda. */
type Entrada =
  | { readonly tipo: 'abrir'; readonly opcoes: OpcoesDeSessao }
  | { readonly tipo: 'dados'; readonly dados: string }
  | { readonly tipo: 'tamanho'; readonly cols: number; readonly rows: number };

/** Mensagens que o servidor manda. */
type Saida =
  | { readonly tipo: 'dados'; readonly dados: string }
  | { readonly tipo: 'fim'; readonly exitCode: number; readonly signal?: number }
  | { readonly tipo: 'erro'; readonly mensagem: string };

export interface DepsDoSocket {
  readonly registry: TerminalRegistry;
  /** Monta as opções a partir do que o cliente pediu; valida na fronteira. */
  resolverAbertura(pedido: unknown): Promise<OpcoesDeSessao>;
}

export function montarSocketDeTerminal(
  server: Server,
  { registry, resolverAbertura }: DepsDoSocket
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

  let proximo = 0;
  wss.on('connection', (ws: WebSocket) => {
    const id = `term-${(proximo += 1)}`;
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
        void (async () => {
          try {
            const sessao = registry.abrir(id, await resolverAbertura(msg.opcoes));
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

      const sessao = registry.obter(id);
      if (sessao === null) return;
      if (msg.tipo === 'dados') sessao.write(msg.dados);
      else if (msg.tipo === 'tamanho') sessao.resize(msg.cols, msg.rows);
    });

    // Fechar a aba encerra o processo — senão o `mysql` ficaria vivo sozinho,
    // com o arquivo de credencial ainda em disco.
    ws.on('close', () => registry.fechar(id));
  });

  return wss;
}
