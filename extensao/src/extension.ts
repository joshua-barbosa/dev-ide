// Braytech Code dentro do VS Code e do Cursor.
//
// **A barra lateral é o painel da IDE, não uma imitação dele.** `Databases` e
// `Services` são webviews que carregam o `ConnectionsPanel` de verdade, com os
// menus, os ícones e os diálogos da IDE — porque é o mesmo código. Ver
// `painelWebview.ts` e `src/ui/extensao/painel.tsx`.
//
// A árvore nativa do editor foi a tentativa anterior, e ele a derrubou em
// minutos de uso: ícone traduzido à mão que não batia, menu de contexto virando
// lista de opções, hover sem ação nenhuma. Nada disso era um defeito solto — era
// o custo permanente de manter uma imitação em dia com o original.
//
// A extensão em si faz três coisas: sobe o motor, abre o que o painel pedir, e
// executa `.sql` com Ctrl+Enter.

import * as vscode from 'vscode';
import { ArquivosRemotos } from './arquivosRemotos';
import { ligarMotor, type Motor } from './motor';
import {
  abrirAbaDaIde, abrirDiagramaEmAba, abrirDialogoEmAba, abrirFormularioDeConexao,
} from './formularioAba';
import { PainelDeConexoes } from './painelWebview';
import { abrirTerminalRemoto } from './terminalRemoto';
import type { DepsDoPainel } from './ponteDoHost';
import type { Painel } from './paineis';

/** A conexão em que o Ctrl+Enter executa. Vem do painel. */
let conexaoAtiva: string | null = null;
let barra: vscode.StatusBarItem | null = null;

/** Linhas por página na prévia de uma tabela. */
const POR_PAGINA = 200;

export async function activate(contexto: vscode.ExtensionContext): Promise<void> {
  const conf = vscode.workspace.getConfiguration('braytech');
  const porta = conf.get<number>('porta') ?? 4321;

  let motor: Motor;
  try {
    motor = await ligarMotor(
      porta,
      conf.get<string>('motor') ?? '',
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
    );
  } catch (erro) {
    // Sem motor não há extensão. Dizer isso uma vez, claro, é melhor que
    // deixar cada gesto falhar depois com uma mensagem de rede.
    void vscode.window.showErrorMessage(
      `Braytech Code: não consegui subir o motor na porta ${porta}. ${mensagem(erro)}`
    );
    return;
  }

  const pedir = async <T>(metodo: string, rota: string, corpo?: unknown): Promise<T | null> => {
    try {
      return await motor.pedir<T>(metodo, rota, corpo);
    } catch (erro) {
      void vscode.window.showErrorMessage(`Braytech Code: ${mensagem(erro)}`);
      return null;
    }
  };

  // Arquivo remoto vira arquivo DE VERDADE do editor: abre, edita e o Ctrl+S
  // grava no servidor. Ele usa SSH exatamente para isso.
  contexto.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('braytech', new ArquivosRemotos(motor), {
      isCaseSensitive: true,
    })
  );

  const definirConexaoAtiva = (id: string): void => {
    conexaoAtiva = id;
    atualizarBarra();
  };

  /**
   * Abre um arquivo de query da conexão.
   *
   * Pela rota `/api/queries/open`, que **cria o arquivo se não existir** — é a
   * mesma da IDE, então o `.sql` aberto aqui é o mesmo que aparece lá.
   */
  const abrirQuery = async (
    connectionId: string,
    database: string | null,
    titulo: string,
    conteudo: string
  ): Promise<void> => {
    if (database === null) {
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: conteudo });
      await vscode.window.showTextDocument(doc);
      return;
    }
    const r = await pedir<{ readonly caminho: string }>('POST', '/api/queries/open', {
      connectionId,
      database,
      nome: titulo,
    });
    if (r === null) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(r.caminho));
    const editor = await vscode.window.showTextDocument(doc);
    // Conteúdo sugerido só entra em arquivo VAZIO: sobrescrever a query que ele
    // já escreveu seria perder trabalho dele por causa de um clique de menu.
    if (conteudo !== '' && doc.getText().trim() === '') {
      await editor.edit((e) => e.insert(new vscode.Position(0, 0), conteudo));
    }
  };

  // Uma só dependência para os dois painéis e para a aba do formulário: eles
  // abrem as mesmas coisas, e duplicar isso daria gestos que funcionam num
  // lugar e não no outro — que foi exatamente o que ele encontrou antes.
  const deps: DepsDoPainel = {
    motor,
    extensionUri: contexto.extensionUri,
    abrirQuery,
    definirConexaoAtiva,
    abrirFormulario: (conexaoId, grupo, rotulo) =>
      abrirFormularioDeConexao(deps, conexaoId, grupo, rotulo),
    abrirDialogo: (dialogo, pedido) => abrirDialogoEmAba(deps, dialogo, pedido),
    abrirDiagrama: (titulo, markdown) => abrirDiagramaEmAba(deps, titulo, markdown),
    abrirTerminal: (connectionId, rotulo) => abrirTerminalRemoto(deps, connectionId, rotulo),
    abrirAbaDaIde: (tipo, titulo, dados) => {
      if (tipo !== 'caderno') {
        abrirAbaDaIde(deps, tipo, titulo, dados);
        return;
      }
      // O caderno precisa do conteúdo do arquivo, e quem sabe ler é o motor.
      void (async () => {
        const r = await pedir<{ content: string }>(
          'GET',
          `/api/file?path=${encodeURIComponent(String(dados.caminho))}`
        );
        if (r === null) return;
        abrirAbaDaIde(deps, tipo, titulo, { ...dados, conteudo: r.content });
      })();
    },
    recarregarPaineis: (conexaoId, caminho, filtro) =>
      PainelDeConexoes.recarregarTodos(conexaoId, caminho, filtro),
  };

  for (const [painel, view] of [
    ['database', 'braytech.databases'],
    ['service', 'braytech.servicos'],
  ] as const) {
    contexto.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        view,
        new PainelDeConexoes(painel as Painel, deps),
        // O painel guarda o que está expandido; redesenhar do zero a cada troca
        // de aba da barra lateral recolheria a árvore inteira.
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );
  }

  barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  barra.command = 'braytech.recarregar';
  atualizarBarra();
  barra.show();
  contexto.subscriptions.push(barra);

  contexto.subscriptions.push(
    vscode.commands.registerCommand('braytech.recarregar', () => {
      void vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
    }),

    vscode.commands.registerCommand('braytech.destrancarCofre', async () => {
      // O cofre também se destranca DENTRO do painel, com o diálogo da IDE.
      // Este comando existe para a paleta, que é onde se procura por nome.
      const senha = await vscode.window.showInputBox({
        prompt: 'Senha-mestra do cofre da Braytech Code',
        password: true,
        ignoreFocusOut: true,
      });
      if (senha === undefined || senha === '') return;
      const ok = await pedir('POST', '/api/connections/vault/unlock', { password: senha });
      if (ok === null) return;
      void vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
      void vscode.window.showInformationMessage('Braytech Code: cofre destrancado.');
    }),

    vscode.commands.registerCommand('braytech.novaConexao', () => {
      abrirFormularioDeConexao(deps, null, '', '');
    }),

    vscode.commands.registerCommand('braytech.novaConsulta', async () => {
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: '' });
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('braytech.executar', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) return;
      if (conexaoAtiva === null) {
        void vscode.window.showWarningMessage(
          'Braytech Code: escolha uma conexão no painel antes de executar.'
        );
        return;
      }
      // A seleção manda quando existe: rodar o arquivo inteiro quando ele marcou
      // três linhas seria fazer outra coisa do que ele pediu.
      const selecao = editor.document.getText(editor.selection);
      const sql = selecao.trim() === '' ? editor.document.getText() : selecao;
      if (sql.trim() === '') return;

      const alvo = conexaoAtiva;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Braytech Code: executando…' },
        async () => {
          const r = await pedir<unknown>(
            'POST',
            `/api/connections/${encodeURIComponent(alvo)}/execute`,
            { statement: sql }
          );
          // A grade da IDE, e não uma tabela de HTML montada à mão.
          if (r !== null) abrirAbaDaIde(deps, 'resultado', alvo, { resultado: r });
        }
      );
    })
  );
}

function atualizarBarra(): void {
  if (barra === null) return;
  barra.text =
    conexaoAtiva === null ? '$(database) Braytech: sem conexão' : `$(database) ${conexaoAtiva}`;
  barra.tooltip = 'A conexão em que o Ctrl+Enter executa';
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export function deactivate(): void {
  // O motor segue de pé de propósito: ele pode ser o mesmo da IDE própria, e
  // derrubá-lo aqui fecharia as conexões de uma janela que não é nossa.
}
