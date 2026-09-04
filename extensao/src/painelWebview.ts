// O painel da IDE hospedado na barra lateral do VS Code.
//
// A árvore nativa do editor foi a primeira tentativa, e ele derrubou em minutos:
// ícone traduzido à mão que não bate, menu de contexto virando lista de opções,
// hover sem ação. Nenhum desses é consertável de vez — são o custo de manter
// uma imitação em dia com o original.
//
// Aqui não há imitação: a webview carrega o `ConnectionsPanel` da IDE, com os
// menus e diálogos dela. O que atravessa para o editor é só ABRIR, e quem leva
// é a `PonteDoHost`.

import * as vscode from 'vscode';
import { htmlDaWebview, PonteDoHost, type DepsDoPainel } from './ponteDoHost';
import type { Painel } from './paineis';

export type { DepsDoPainel } from './ponteDoHost';

export class PainelDeConexoes implements vscode.WebviewViewProvider {
  /** As vistas vivas, para uma mudança no cofre alcançar as duas de uma vez. */
  private static readonly vivas = new Set<vscode.Webview>();

  /**
   * Manda todo painel aberto reler o cofre.
   *
   * Salvar uma conexão acontece na ABA do formulário, que é outra webview: sem
   * este aviso a barra lateral seguiria mostrando a árvore de antes, e ele teria
   * de apertar Recarregar para ver o que acabou de criar.
   */
  static recarregarTodos(): void {
    for (const web of PainelDeConexoes.vivas) void web.postMessage({ tipo: 'recarregar' });
  }

  constructor(
    private readonly painel: Painel,
    private readonly deps: DepsDoPainel
  ) {}

  resolveWebviewView(vista: vscode.WebviewView): void {
    const web = vista.webview;
    web.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.deps.extensionUri, 'webview')],
    };
    web.html = htmlDaWebview(web, this.deps.extensionUri, 'painel.js', {
      base: `http://127.0.0.1:${this.deps.motor.porta}`,
      painel: this.painel,
    });

    new PonteDoHost(this.deps).ligar(web);

    PainelDeConexoes.vivas.add(web);
    vista.onDidDispose(() => PainelDeConexoes.vivas.delete(web));
  }
}
