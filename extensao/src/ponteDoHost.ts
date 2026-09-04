// O que atravessa entre uma webview da Braytech Code e o VS Code.
//
// Existe separado porque agora são DOIS hospedeiros com a mesma fiação: a barra
// lateral (`painelWebview.ts`) e a aba de formulário (`formularioAba.ts`). Sem
// isto, o formulário só ganharia metade dos gestos — e a metade que falta é
// sempre a que ele descobre depois.
//
// Três canais:
//  - `api`         → pedido ao motor, respondido com `apiResposta`;
//  - `hostChamada` → o que só o editor sabe fazer, respondido com `hostResposta`;
//  - o resto       → ABRIR coisas, sem resposta.

import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { uriRemota } from './arquivosRemotos';
import type { Motor } from './motor';

/** O que a webview pode pedir. Nada fora desta lista é atendido. */
export type PedidoDoPainel =
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
      readonly database: string | null;
      readonly somenteLeitura: boolean;
    }
  | {
      readonly tipo: 'abrirChave';
      readonly connectionId: string;
      readonly chave: string;
      readonly somenteLeitura: boolean;
    }
  | { readonly tipo: 'fecharArquivo'; readonly caminho: string }
  | { readonly tipo: 'abrirResultado'; readonly titulo: string; readonly resultado: unknown }
  | {
      readonly tipo: 'abrirCaderno';
      readonly caminho: string;
      readonly connectionId: string | null;
      readonly database: string | null;
    }
  | { readonly tipo: 'abrirTerminal'; readonly connectionId: string; readonly rotulo: string }
  | {
      // O formulário é ABA, não caixa. Ver `formularioAba.ts`.
      readonly tipo: 'abrirFormulario';
      readonly conexaoId: string | null;
      readonly grupo: string;
      /** O nome da conexão, só para a aba não se chamar por um id. */
      readonly rotulo: string;
    }
  | { readonly tipo: 'fecharFormulario' }
  | { readonly tipo: 'abrirDiagrama'; readonly titulo: string; readonly markdown: string }
  | {
      // Os diálogos ricos (criar objeto, filtrar) também saem da coluna: são
      // formulários, e formulário aqui é aba.
      readonly tipo: 'abrirDialogo';
      readonly dialogo: 'criacao' | 'filtro';
      readonly pedido: unknown;
    }
  | {
      readonly tipo: 'conexoesMudaram';
      /** Quando vem, recarrega SÓ aquele ramo — a árvore não se recolhe. */
      readonly conexaoId?: string;
      readonly caminho?: readonly string[];
      /** Presente só quando a aba de filtro devolve a escolha dele. */
      readonly filtro?: unknown;
    }
  | {
      readonly tipo: 'abrirSemTitulo';
      readonly conteudo: string;
      readonly linguagem: string;
    }
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

/** Um pedido à API do motor, feito pela webview. */
interface PedidoDeApi {
  readonly id: number;
  readonly metodo: string;
  readonly rota: string;
  readonly corpo?: unknown;
}

export interface DepsDoPainel {
  readonly motor: Motor;
  readonly extensionUri: vscode.Uri;
  /** Abre um arquivo de query, criando-o se ainda não existir. */
  abrirQuery(
    connectionId: string,
    database: string | null,
    titulo: string,
    conteudo: string
  ): Promise<void>;
  /** Diz ao resto da extensão qual conexão está em foco. */
  definirConexaoAtiva(id: string): void;
  /** Abre o formulário de conexão como aba do editor. */
  abrirFormulario(conexaoId: string | null, grupo: string, rotulo: string): void;
  /** Abre um diálogo rico como aba do editor. */
  abrirDialogo(dialogo: 'criacao' | 'filtro', pedido: unknown): void;
  /** Abre o diagrama ER desenhado, em aba própria. */
  abrirDiagrama(titulo: string, markdown: string): void;
  /**
   * Abre uma aba da IDE — tabela, chave, resultado, caderno.
   *
   * São os painéis ORIGINAIS. A `<table>` que eu desenhava à mão no host não
   * tinha ordenação, paginação, visor de célula nem a sub-aba de estrutura, e
   * ele viu isso na primeira olhada.
   */
  abrirAbaDaIde(tipo: string, titulo: string, dados: Record<string, unknown>): void;
  /** Manda todo painel vivo reler o cofre — depois de salvar ou excluir. */
  recarregarPaineis(
    conexaoId?: string,
    caminho?: readonly string[],
    filtro?: unknown
  ): void;
}

/** Um canal de saída para a extensão inteira, e não um por webview. */
let canal: vscode.OutputChannel | null = null;

function saida(): vscode.OutputChannel {
  canal ??= vscode.window.createOutputChannel('Braytech Code');
  return canal;
}

export class PonteDoHost {
  constructor(
    private readonly deps: DepsDoPainel,
    /** O que fazer quando a webview pede para se fechar. Só a aba tem isso. */
    private readonly aoFechar: (() => void) | null = null
  ) {}

  ligar(web: vscode.Webview): void {
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
   * Leva um pedido da webview até o motor, e devolve a resposta.
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

      case 'confirmar': {
        // O diálogo do PRÓPRIO editor: centralizado na janela inteira, com
        // teclado e tema dele. A caixa desenhada dentro do painel ficava numa
        // coluna de 300 px, cinza sobre cinza — foi o print que ele mandou.
        const rotulo = String(a.rotuloConfirmar ?? 'OK');
        const escolha = await vscode.window.showWarningMessage(
          String(a.titulo ?? '') === '' ? String(a.mensagem ?? '') : String(a.titulo),
          {
            modal: true,
            ...(String(a.titulo ?? '') === '' ? {} : { detail: String(a.mensagem ?? '') }),
          },
          rotulo
        );
        // Esc e "Cancelar" devolvem `undefined`: recusar é o padrão seguro.
        return escolha === rotulo;
      }

      case 'avisar':
        await vscode.window.showInformationMessage(
          String(a.titulo ?? '') === '' ? String(a.mensagem ?? '') : String(a.titulo),
          {
            modal: true,
            ...(String(a.titulo ?? '') === '' ? {} : { detail: String(a.mensagem ?? '') }),
          }
        );
        return null;

      case 'pedirSenha':
        // Senha vai na caixa nativa, com `password: true`: ela não fica no DOM
        // da webview nem aparece em captura de tela.
        return (
          (await vscode.window.showInputBox({
            title: String(a.titulo ?? ''),
            password: true,
            ignoreFocusOut: true,
            ...(typeof a.prompt === 'string' ? { prompt: a.prompt } : {}),
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

      case 'escreverNaSaida':
        saida().appendLine(String(a.texto ?? ''));
        if (a.erro === true) saida().show(true);
        return null;

      case 'mostrarSaida':
        saida().show(true);
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

  private async atender(p: PedidoDoPainel): Promise<void> {
    try {
      switch (p.tipo) {
        case 'abrirArquivo': {
          if (p.caminho.endsWith('.sqlbook')) {
            // O caderno é DESENHADO, com os blocos da IDE. Abri-lo como texto
            // mostrava o JSON cru — foi o print que ele mandou.
            this.deps.abrirAbaDaIde('caderno', p.caminho.split('/').pop() ?? 'Caderno', {
              caminho: p.caminho,
              connectionId: null,
              database: null,
            });
            return;
          }
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p.caminho));
          await vscode.window.showTextDocument(doc);
          return;
        }
        case 'abrirArquivoRemoto': {
          // URI `braytech:`, servida pelo FileSystemProvider: abre EDITÁVEL, e
          // o Ctrl+S grava no servidor pelas rotas do motor.
          const doc = await vscode.workspace.openTextDocument(uriRemota(p.conexaoId, p.caminho));
          await vscode.window.showTextDocument(doc);
          return;
        }
        case 'abrirQuery':
          this.deps.definirConexaoAtiva(p.connectionId);
          await this.deps.abrirQuery(p.connectionId, p.database, p.titulo, p.conteudo);
          return;
        case 'abrirTabela':
          this.deps.definirConexaoAtiva(p.connectionId);
          // A grade da IDE, com ordenação, paginação, visor de célula e a
          // sub-aba de estrutura. A <table> que eu montava aqui não tinha nada
          // disso, e ele viu na primeira olhada.
          this.deps.abrirAbaDaIde('tabela', p.titulo, {
            connectionId: p.connectionId,
            nodePath: p.nodePath,
            database: p.database,
            somenteLeitura: p.somenteLeitura,
          });
          return;
        case 'abrirFormulario':
          this.deps.abrirFormulario(p.conexaoId, p.grupo, p.rotulo);
          return;
        case 'fecharFormulario':
          this.aoFechar?.();
          return;
        case 'abrirDialogo':
          this.deps.abrirDialogo(p.dialogo, p.pedido);
          return;
        case 'abrirDiagrama':
          this.deps.abrirDiagrama(p.titulo, p.markdown);
          return;
        case 'conexoesMudaram':
          this.deps.recarregarPaineis(p.conexaoId, p.caminho, p.filtro);
          return;
        case 'abrirTerminal':
          this.deps.definirConexaoAtiva(p.connectionId);
          void vscode.window.showInformationMessage(
            `Terminal de ${p.rotulo}: ainda não ligado no VS Code.`
          );
          return;
        case 'abrirChave':
          this.deps.definirConexaoAtiva(p.connectionId);
          this.deps.abrirAbaDaIde('chave', p.chave, {
            conexaoId: p.connectionId,
            chave: p.chave,
            somenteLeitura: p.somenteLeitura,
          });
          return;
        case 'abrirResultado':
          this.deps.abrirAbaDaIde('resultado', p.titulo, { resultado: p.resultado });
          return;
        case 'abrirCaderno':
          this.deps.abrirAbaDaIde('caderno', p.caminho.split('/').pop() ?? 'Caderno', {
            caminho: p.caminho,
            connectionId: p.connectionId,
            database: p.database,
          });
          return;
        case 'abrirSemTitulo': {
          const doc = await vscode.workspace.openTextDocument({
            language: p.linguagem,
            content: p.conteudo,
          });
          await vscode.window.showTextDocument(doc);
          return;
        }
        case 'fecharArquivo': {
          // A aba do arquivo apagado tem de ir junto: deixá-la aberta
          // apontando para o que não existe mais é pior que não abrir.
          const alvo = vscode.Uri.file(p.caminho).toString();
          for (const grupo of vscode.window.tabGroups.all) {
            for (const aba of grupo.tabs) {
              const entrada = aba.input as { uri?: vscode.Uri } | undefined;
              if (entrada?.uri?.toString() === alvo) void vscode.window.tabGroups.close(aba);
            }
          }
          return;
        }
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
}

/**
 * O HTML de uma webview da extensão.
 *
 * **Sem `connect-src`.** Nada aqui faz pedido de rede: tudo passa pela ponte até
 * este processo. Uma webview que não pode abrir conexão é uma superfície a
 * menos, e o motor continua só de loopback.
 *
 * O `#raiz` é flex de altura cheia porque os componentes da IDE contam com um
 * pai que os limita — na IDE é o `aside` da barra lateral. Num div solto a raiz
 * crescia com o conteúdo, o container interno de rolagem nunca ficava limitado,
 * e nada rolava.
 */
export function htmlDaWebview(
  web: vscode.Webview,
  extensionUri: vscode.Uri,
  arquivo: 'painel.js' | 'formulario.js' | 'dialogo.js' | 'diagrama.js' | 'aba.js' | 'caderno.js',
  config: Record<string, unknown>
): string {
  const script = web.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', arquivo));
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Cada pacote tem a folha DELE, e nem todos têm uma. Perguntar ao disco é o
  // que evita ligar um arquivo que não existe — ou, pior, o de outro pacote.
  const nomeDoCss = arquivo.replace(/\.js$/, '.css');
  const caminhoDoCss = vscode.Uri.joinPath(extensionUri, 'webview', nomeDoCss);
  const estilo = fs.existsSync(caminhoDoCss.fsPath)
    ? `<link rel="stylesheet" href="${web.asWebviewUri(caminhoDoCss).toString()}">`
    : '';

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${web.cspSource} data:; style-src ${web.cspSource} 'unsafe-inline'; font-src ${web.cspSource} data:; script-src 'nonce-${nonce}';">
<style>
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  #raiz { height: 100%; display: flex; flex-direction: column; }
  #raiz > * { flex: 1 1 auto; min-height: 0; }
</style>
${estilo}
</head><body>
<div id="raiz"></div>
<script nonce="${nonce}">window.BRAYTECH=${JSON.stringify(config)};</script>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body></html>`;
}
