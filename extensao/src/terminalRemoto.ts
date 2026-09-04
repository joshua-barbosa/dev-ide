// O terminal de uma conexão, como ABA do editor.
//
// Eu o abri no painel de baixo e ele corrigiu: *"você abriu o terminal embaixo
// e não como uma aba que deveria ser"*. Quando ele disse que a ferramenta que a
// Braytech Code substitui já provava o desenho, estava falando da ABA — eu li
// como se fosse do painel.
//
// Continua sendo o terminal NATIVO: o editor abre terminal na área de edição
// por `TerminalLocation.Editor`, então a aba tem a fonte, o tema, a busca e o
// copiar/colar dele, sem webview no meio. A escolha entre painel e aba é de
// LOCAL, não de implementação — e é por isso que ela cabe numa linha.
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

/**
 * Quantos terminais já saíram de cada conexão, para numerar o nome.
 *
 * Dois terminais chamados `Playground` são indistinguíveis na barra de abas, e
 * a primeira coisa que se faz com dois terminais é alternar entre eles.
 */
const quantos = new Map<string, number>();

/**
 * Destranca o grupo de editores ativo.
 *
 * O editor TRANCA todo grupo que recebe um terminal — `autoLockGroups` traz
 * `terminalEditor: true` de fábrica —, e grupo trancado recusa editores novos:
 * cada terminal seguinte era obrigado a abrir a própria coluna, dividindo a
 * tela. Ele perguntou a coisa certa: *"as outras coisas abrem normal sem
 * precisar colocar isso aí, porque o nosso não pode?"*. Porque as outras abas
 * nossas são webviews, e o editor só tranca grupo de TERMINAL.
 *
 * Destrancar aqui é o que dispensa mexer nas configurações dele: uma
 * configuração global valeria para todo terminal do editor, e o preço de um
 * detalhe nosso não é dele pagar. Destrancar um grupo já destrancado não faz
 * nada, então não há caso ruim.
 */
async function destrancarOGrupo(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
  } catch {
    // Comando ausente numa versão do editor não pode derrubar a abertura do
    // terminal: no pior caso ele abre em coluna própria, como abria antes.
  }
}

/**
 * Abre um terminal da conexão. **Um por clique.**
 *
 * Eu tinha guardado um por conexão e revelado o existente no segundo clique,
 * supondo que quem clica de novo quer ver o que já abriu. Ele corrigiu: *"se eu
 * clicar uma segunda vez no abrir terminal, ele deveria abrir um novo terminal,
 * e não simplesmente não fazer nada"*.
 *
 * E ele tem razão sobre o pior caso: com o terminal aberto numa aba escondida
 * atrás de outras, o clique parecia não fazer NADA — a única resposta era uma
 * aba longe da vista ganhando foco, ou nem isso.
 */
export function abrirTerminalRemoto(
  deps: DepsDoPainel,
  connectionId: string,
  rotulo: string
): void {
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
        // **A aba FICA.** Eu fechava no instante do `fim`, e o editor
        // substituía a tela inteira por "The terminal process failed to launch
        // (exit code: 1)" — apagando a única coisa útil, que é o que o cliente
        // imprimiu antes de morrer ("connection to server ... failed",
        // "ERROR 2003 ... Can't connect"). Ele viu só a mensagem genérica.
        //
        // É a mesma decisão que a IDE já tinha tomado: ler o motivo depois de o
        // processo morrer é metade da utilidade de um terminal. Quem fecha é
        // ele, no X da aba.
        fim: (codigo) =>
          escrever.fire(emCinza(`[processo encerrado com código ${codigo}]`)),
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
    },

    handleInput: (dados) => canal?.digitar(dados),

    setDimensions(medidas) {
      cols = medidas.columns;
      rows = medidas.rows;
      canal?.redimensionar(cols, rows);
    },
  };

  const ordem = (quantos.get(connectionId) ?? 0) + 1;
  quantos.set(connectionId, ordem);

  const abrir = (): vscode.Terminal =>
    vscode.window.createTerminal({
      // O segundo em diante leva o número: na barra de abas, dois `Playground`
      // não se distinguem.
      name: ordem === 1 ? rotulo : `${rotulo} ${ordem}`,
      pty,
      iconPath: new vscode.ThemeIcon('server'),
      // Na área do EDITOR, e não no painel de baixo: um terminal de servidor é
      // onde se trabalha, e trabalhar numa tira de dez linhas embaixo da tela é
      // outra coisa. Ele pediu com todas as letras.
      //
      // E na coluna ATIVA, dita por extenso. Com o enum `TerminalLocation.Editor`
      // sozinho, o editor abria AO LADO, dividindo a tela — "ele abre dividindo a
      // tela, ao invés de ser uma aba". Uma aba é uma aba no grupo onde ele já
      // está; dividir é gesto dele, não meu.
      location: { viewColumn: vscode.ViewColumn.Active },
    });

  void (async () => {
    // **Antes de criar**, e não depois: a trava que atrapalha é a que o
    // terminal ANTERIOR deixou no grupo. Destrancar só depois já seria tarde —
    // este aqui já teria nascido numa coluna nova.
    await destrancarOGrupo();
    const terminal = abrir();
    terminal.show();
    // E de novo, para o PRÓXIMO caber neste mesmo grupo.
    await destrancarOGrupo();
  })();
}
