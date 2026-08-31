// Canal do vigia de disco, por WebSocket.
//
// Mesmo motivo do terminal: quem tem o que dizer é o SERVIDOR, e REST não tem
// como empurrar. A alternativa seria a interface perguntar "mudou algo?" de
// tempos em tempos — um pedido por segundo, por aba aberta, para responder
// "não" quase sempre.
//
// A guarda de origem roda no `upgrade`, como no terminal. Aqui não nasce
// processo nenhum, mas o canal conta o que existe no disco do usuário.
import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { isAllowedRequest } from './http/security';
import { Vigia, type Mudanca } from './vigia';
import type { EstadoStore } from './estado';

export const CAMINHO_DO_VIGIA = '/api/watch';

/** O que o servidor manda. */
export type AvisoDoVigia =
  | { readonly tipo: 'mudou'; readonly mudancas: readonly Mudanca[] }
  | { readonly tipo: 'lotou' };

export function montarSocketDoVigia(server: Server, estado: EstadoStore): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!(req.url ?? '').startsWith(CAMINHO_DO_VIGIA)) return;
    if (!isAllowedRequest({ host: req.headers.host, origin: req.headers.origin })) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const pastas = estado.ler().pastas;
    if (pastas.length === 0) {
      // Sem pasta aberta não há o que vigiar. Fechar é mais honesto que manter
      // um canal mudo que nunca vai falar.
      ws.close();
      return;
    }

    const enviar = (aviso: AvisoDoVigia): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(aviso));
    };

    // **Um vigia por RAIZ** (T004). O `inotify` observa uma árvore, e três
    // raízes são três árvores; juntar tudo num só exigiria um caminho comum,
    // que pode ser `/` — e vigiar o disco inteiro derruba a máquina.
    const vigias: Vigia[] = [];
    try {
      for (const pasta of pastas) {
        vigias.push(new Vigia(pasta, {
          aoMudar: (mudancas) => enviar({ tipo: 'mudou', mudancas }),
          aoLotar: () => enviar({ tipo: 'lotou' }),
        }));
      }
    } catch {
      // Pasta que sumiu entre abrir a página e conectar: não é motivo para erro.
      for (const v of vigias) v.parar();
      ws.close();
      return;
    }

    // **Um vigia por conexão, e ele morre com ela.** Duas abas da IDE abertas
    // custam dois conjuntos de observadores; em troca, fechar uma não cega a
    // outra, e não sobra vigia órfão consumindo `inotify` até o servidor cair.
    const pararTodos = (): void => {
      for (const v of vigias) v.parar();
    };
    ws.on('close', pararTodos);
    ws.on('error', pararTodos);
  });

  return wss;
}
