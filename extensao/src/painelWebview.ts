// O painel da IDE hospedado na barra lateral do VS Code.
//
// A árvore nativa do editor foi a primeira tentativa, e ele derrubou em minutos:
// ícone traduzido à mão que não bate, menu de contexto virando lista de opções,
// hover sem ação. Nenhum desses é consertável de vez — são o custo de manter
// uma imitação em dia com o original.
//
// Aqui não há imitação: a webview carrega o `ConnectionsPanel` da IDE, com os
// menus e diálogos dela. O que atravessa para o editor é só ABRIR.

import * as vscode from 'vscode';
import type { Motor } from './motor';
import { uriRemota } from './arquivosRemotos';
import type { Painel } from './paineis';

/** O que a webview pode pedir. Nada fora desta lista é atendido. */
type PedidoDoPainel =
  | { readonly tipo: 'abrirArquivo'; readonly caminho: string }
  | {
      readonly tipo: 'abrirArquivoRemoto';
      readonly conexaoId: string;
      readonly caminho: string;
    }
  | {
      readonly tipo: 'abrirQuery';
      readonly connectionId: string;
      readonly database: string | null;
      readonly titulo: string;
      readonly conteudo: string;
    }
  | {
      readonly tipo: 'abrirTabela';
      readonly connectionId: string;
      readonly nodePath: readonly string[];
      readonly titulo: string;
    }
  | { readonly tipo: 'abrirChave'; readonly connectionId: string; readonly chave: string }
  | { readonly tipo: 'abrirTerminal'; readonly connectionId: string; readonly rotulo: string }
  | { readonly tipo: 'copiar'; readonly texto: string }
  | { readonly tipo: 'avisar'; readonly mensagem: string }
  | { readonly tipo: 'erro'; readonly mensagem: string }
  | { readonly tipo: 'naoImplementado'; readonly o_que: string };

/** Uma chamada ao host que devolve resposta — caixa de texto, saída, download. */
interface ChamadaAoHost {
  readonly id: number;
  readonly acao: string;
  readonly args: Record<string, unknown>;
}

/** Um pedido à API do motor, feito pelo painel. */
interface PedidoDeApi {
  readonly id: number;
  readonly metodo: string;
  readonly rota: string;
  readonly corpo?: unknown;
}

export interface DepsDoPainel {
  readonly motor: Motor;
  readonly extensionUri: vscode.Uri;
  /** Abre a grade de uma tabela. Mora no `extension.ts`, que tem a webview. */
  abrirTabela(connectionId: string, nodePath: readonly string[], titulo: string): Promise<void>;
  /** Abre um arquivo de query, criando-o se ainda não existir. */
  abrirQuery(
    connectionId: string,
    database: string | null,
    titulo: string,
    conteudo: string
  ): Promise<void>;
  /** Diz ao resto da extensão qual conexão está em foco. */
  definirConexaoAtiva(id: string): void;
}

export class PainelDeConexoes implements vscode.WebviewViewProvider {
  /** Um canal de saída para a extensão inteira, e não um por painel. */
  private static canal: vscode.OutputChannel | null = null;

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
    web.html = this.html(web);

    web.onDidReceiveMessage((bruto: unknown) => {
      // Mensagem é DADO, nunca instrução: o `tipo` é conferido contra a lista
      // acima e o que não estiver nela é ignorado em silêncio.
      const m = bruto as { tipo?: string };
      if (m?.tipo === 'api') {
        void this.repassarAoMotor(web, bruto as PedidoDeApi);
        return;
      }
      if (m?.tipo === 'hostChamada') {
        void this.atenderChamada(web, bruto as ChamadaAoHost);
        return;
      }
      void this.atender(bruto as PedidoDoPainel);
    });
  }

  /**
   * Leva um pedido do painel até o motor, e devolve a resposta.
   *
   * É por aqui que a API passa. A webview não pode falar com o motor direto: a
   * origem dela é `vscode-webview://`, e o motor só aceita loopback — o
   * navegador transforma isso em CORS bloqueado ("Failed to fetch", que foi o
   * que ele viu). Repassar daqui resolve **sem afrouxar a guarda do motor**:
   * este processo é Node, não tem CORS, e a superfície exposta continua a mesma.
   */
  private async repassarAoMotor(web: vscode.Webview, p: PedidoDeApi): Promise<void> {
    try {
      const data = await this.deps.motor.pedir<unknown>(p.metodo, p.rota, p.corpo);
      void web.postMessage({ tipo: 'apiResposta', id: p.id, ok: true, data });
    } catch (erro) {
      void web.postMessage({
        tipo: 'apiResposta',
        id: p.id,
        ok: false,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  /**
   * O que só o editor sabe fazer: pedir um texto, escolher de uma lista, abrir
   * markdown, escrever numa saída, salvar um download.
   *
   * Reimplementar isso dentro da webview daria uma caixa de diálogo estranha no
   * meio de um editor que já tem a dele — e teclado, tema e acessibilidade de
   * graça se perderiam junto.
   */
  private async atenderChamada(web: vscode.Webview, c: ChamadaAoHost): Promise<void> {
    const responder = (ok: boolean, data: unknown, erro?: string): void => {
      void web.postMessage({ tipo: 'hostResposta', id: c.id, ok, data, erro });
    };
    try {
      responder(true, await this.executarChamada(c));
    } catch (erro) {
      responder(false, null, erro instanceof Error ? erro.message : String(erro));
    }
  }

  private async executarChamada(c: ChamadaAoHost): Promise<unknown> {
    const a = c.args;
    switch (c.acao) {
      case 'pedirTexto':
        return (
          (await vscode.window.showInputBox({
            title: String(a.titulo ?? ''),
            value: typeof a.valorInicial === 'string' ? a.valorInicial : '',
            ...(typeof a.placeholder === 'string' ? { placeHolder: a.placeholder } : {}),
            ignoreFocusOut: true,
          })) ?? null
        );

      case 'escolher': {
        const opcoes = (a.opcoes ?? []) as readonly {
          valor: string; rotulo: string; detalhe?: string;
        }[];
        const escolha = await vscode.window.showQuickPick(
          opcoes.map((o) => ({
            label: o.rotulo,
            ...(o.detalhe === undefined ? {} : { detail: o.detalhe }),
            valor: o.valor,
          })),
          { title: String(a.titulo ?? ''), ignoreFocusOut: true }
        );
        return escolha?.valor ?? null;
      }

      case 'abrirMarkdown': {
        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: String(a.conteudo ?? ''),
        });
        await vscode.window.showTextDocument(doc, { preview: false });
        // O VS Code desenha Mermaid na pré-visualização desde a 1.87, então o
        // diagrama sai desenhado sem carregar biblioteca nenhuma.
        await vscode.commands.executeCommand('markdown.showPreviewToSide');
        return null;
      }

      case 'escreverNaSaida':
        this.saida().appendLine(String(a.texto ?? ''));
        if (a.erro === true) this.saida().show(true);
        return null;

      case 'mostrarSaida':
        this.saida().show(true);
        return null;

      case 'baixarRemoto': {
        const nome = String(a.caminho ?? '').split('/').pop() ?? 'arquivo';
        const destino = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(nome),
        });
        if (destino === undefined) return null;
        const r = await this.deps.motor.pedir<{ content: string }>(
          'GET',
          `/api/connections/${encodeURIComponent(String(a.conexaoId))}/files` +
            `?path=${encodeURIComponent(String(a.caminho))}`
        );
        await vscode.workspace.fs.writeFile(destino, new TextEncoder().encode(r.content));
        void vscode.window.showInformationMessage(`Braytech Code: ${nome} salvo.`);
        return null;
      }

      default:
        // Ação desconhecida é DADO estranho, não instrução: recusa e diz.
        throw new Error(`Ação desconhecida: ${c.acao}`);
    }
  }

  private saida(): vscode.OutputChannel {
    PainelDeConexoes.canal ??= vscode.window.createOutputChannel('Braytech Code');
    return PainelDeConexoes.canal;
  }

  private async atender(p: PedidoDoPainel): Promise<void> {
    try {
      switch (p.tipo) {
        case 'abrirArquivo': {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p.caminho));
          await vscode.window.showTextDocument(doc);
          if (p.caminho.endsWith('.sqlbook')) {
            // Dito antes de ele descobrir: o caderno abre como TEXTO. Desenhá-lo
            // pede a API de Notebook do editor, que ainda não foi feita.
            void vscode.window.showInformationMessage(
              'O .sqlbook abre como texto por enquanto — o caderno ainda não é desenhado aqui.'
            );
          }
          return;
        }
        case 'abrirArquivoRemoto': {
          // URI `braytech:`, servida pelo FileSystemProvider: abre EDITÁVEL, e
          // o Ctrl+S grava no servidor pelas rotas do motor.
          const doc = await vscode.workspace.openTextDocument(
            uriRemota(p.conexaoId, p.caminho)
          );
          await vscode.window.showTextDocument(doc);
          return;
        }
        case 'abrirQuery':
          this.deps.definirConexaoAtiva(p.connectionId);
          await this.deps.abrirQuery(p.connectionId, p.database, p.titulo, p.conteudo);
          return;
        case 'abrirTabela':
          this.deps.definirConexaoAtiva(p.connectionId);
          await this.deps.abrirTabela(p.connectionId, p.nodePath, p.titulo);
          return;
        case 'abrirTerminal':
          this.deps.definirConexaoAtiva(p.connectionId);
          void vscode.window.showInformationMessage(
            `Terminal de ${p.rotulo}: ainda não ligado no VS Code.`
          );
          return;
        case 'abrirChave':
          void vscode.window.showInformationMessage(
            `Visualizador de chave (${p.chave}): ainda não ligado no VS Code.`
          );
          return;
        case 'copiar':
          await vscode.env.clipboard.writeText(p.texto);
          void vscode.window.setStatusBarMessage('Braytech Code: copiado.', 2000);
          return;
        case 'avisar':
          void vscode.window.showInformationMessage(`Braytech Code: ${p.mensagem}`);
          return;
        case 'erro':
          void vscode.window.showErrorMessage(`Braytech Code: ${p.mensagem}`);
          return;
        case 'naoImplementado':
          // Um item de menu que não faz nada é pior que um item ausente: ele
          // promete. Até a peça existir, o clique diz o que falta.
          void vscode.window.showInformationMessage(
            `Braytech Code: "${p.o_que}" ainda não existe na extensão — use a IDE.`
          );
          return;
        default:
          return;
      }
    } catch (erro) {
      void vscode.window.showErrorMessage(
        `Braytech Code: ${erro instanceof Error ? erro.message : String(erro)}`
      );
    }
  }

  private html(web: vscode.Webview): string {
    const script = web.asWebviewUri(
      vscode.Uri.joinPath(this.deps.extensionUri, 'webview', 'painel.js')
    );
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const motor = `http://127.0.0.1:${this.deps.motor.porta}`;

    // **Sem `connect-src`.** O painel não faz pedido de rede nenhum: tudo passa
    // pela ponte até este processo. Uma webview que não pode abrir conexão é
    // uma superfície a menos, e o motor continua só de loopback.
    return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${web.cspSource} data:; style-src ${web.cspSource} 'unsafe-inline'; font-src ${web.cspSource} data:; script-src 'nonce-${nonce}';">
<style>html,body,#raiz{height:100%;margin:0;padding:0;overflow:hidden}</style>
</head><body>
<div id="raiz"></div>
<script nonce="${nonce}">window.BRAYTECH=${JSON.stringify({ base: motor, painel: this.painel })};</script>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body></html>`;
  }
}
