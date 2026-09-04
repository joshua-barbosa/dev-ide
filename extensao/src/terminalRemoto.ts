// O terminal de uma conexão, no painel Terminal do editor.
//
// Ele decidiu isto pela ferramenta que a Braytech Code substitui: *"já é
// provado, pois a própria extensão que eu usava lá abria"*. E o painel Terminal
// é onde ele já tem fonte, tema, divisão, busca e copiar/colar — nada disso
// precisa ser reescrito aqui.
//
// **Não é imitação.** A árvore nativa foi derrubada por ser cópia pobre de um
// componente que existe; aqui não há o que copiar: o que atravessa são BYTES. O
// `Pseudoterminal` é o terminal de verdade do editor, e este arquivo só liga os
// bytes dele aos do motor — o protocolo mora em `canalDoTerminal.ts`.
//
// O canal é o MESMO WebSocket da IDE (`/api/terminal`): quem abre um shell SSH
// é a sessão que o motor já tem autenticada, então nenhuma senha passa por
// linha de comando nem por arquivo temporário.
//
// Sem dependência nova: o Node do editor (24.x no VS Code e no Cursor) já traz
// `WebSocket` embutido. Empacotamos com `--no-dependencies`, então um
// `require('ws')` aqui simplesmente não existiria em disco.

import * as vscode from 'vscode';
import { emCinza, emVermelho, ligarAoMotor, type CanalDoTerminal } from './canalDoTerminal';
import type { DepsDoPainel } from './ponteDoHost';

/** Um terminal por conexão. Ver o comentário de `abrirTerminalRemoto`. */
const abertos = new Map<string, vscode.Terminal>();

/**
 * Abre — ou revela — o terminal de uma conexão.
 *
 * Um por conexão: um segundo terminal do mesmo servidor é pedido legítimo, mas
 * quem clica duas vezes na árvore quer VER o que já abriu. Para um segundo, o
 * editor tem o botão de dividir, que é onde ele já está acostumado a pedir.
 */
export function abrirTerminalRemoto(
  deps: DepsDoPainel,
  connectionId: string,
  rotulo: string
): void {
  const jaAberto = abertos.get(connectionId);
  if (jaAberto !== undefined) {
    jaAberto.show();
    return;
  }

  if (typeof WebSocket === 'undefined') {
    void vscode.window.showErrorMessage(
      'Braytech Code: este editor roda num Node sem WebSocket, e o terminal remoto precisa dele.'
    );
    return;
  }

  const escrever = new vscode.EventEmitter<string>();
  const fechou = new vscode.EventEmitter<number>();
  let canal: CanalDoTerminal | null = null;
  let cols = 80;
  let rows = 24;

  const pty: vscode.Pseudoterminal = {
    onDidWrite: escrever.event,
    onDidClose: fechou.event,

    open(medidas) {
      if (medidas !== undefined) {
        cols = medidas.columns;
        rows = medidas.rows;
      }
      canal = ligarAoMotor({
        connectionId,
        url: `ws://127.0.0.1:${deps.motor.porta}/api/terminal`,
        cols,
        rows,
        escrever: (texto) => escrever.fire(texto),
        erro: (mensagem) => escrever.fire(emVermelho(mensagem)),
        encerrado: () => escrever.fire(emCinza('[sessão encerrada]')),
        // O terminal FECHA com o código do processo, que é o que o editor
        // mostra ao lado do nome. Deixá-lo aberto e mudo seria pior: no painel
        // Terminal, uma aba viva que não responde parece conexão travada.
        fim: (codigo) => fechou.fire(codigo),
      });
    },

    close() {
      // Fechou de propósito: o motor mata o processo na hora, em vez de segurar
      // a sessão esperando uma reconexão que não vem. É a diferença entre
      // "fechei" e "a janela caiu".
      canal?.fechar();
      canal = null;
      escrever.dispose();
      fechou.dispose();
      abertos.delete(connectionId);
    },

    handleInput: (dados) => canal?.digitar(dados),

    setDimensions(medidas) {
      cols = medidas.columns;
      rows = medidas.rows;
      canal?.redimensionar(cols, rows);
    },
  };

  const terminal = vscode.window.createTerminal({
    name: rotulo,
    pty,
    iconPath: new vscode.ThemeIcon('server'),
  });
  abertos.set(connectionId, terminal);
  terminal.show();
}

/** O editor fechou o terminal por fora (lixeira do painel, fechar janela). */
export function esquecerTerminaisFechados(fechado: vscode.Terminal): void {
  for (const [id, t] of abertos) {
    if (t === fechado) abertos.delete(id);
  }
}
