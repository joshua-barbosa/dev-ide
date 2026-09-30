// O notebook `.brnb` como EDITOR PERSONALIZADO (spec 112, etapa 6).
//
// Clicar num `.brnb` no Explorer abre o notebook, e não o JSON. O editor fica
// amarrado ao DOCUMENTO do VS Code/Cursor: a webview manda o texto novo, e
// este host o aplica como edição no documento. Assim o "não salvo", o Ctrl+S,
// o desfazer e o "o arquivo mudou no disco" são os do próprio editor — em vez
// de uma gravação paralela que discordaria dele.
//
// Fechar o notebook ENCERRA o kernel: a webview some sem avisar ninguém, e um
// Python órfão segurando um DataFrame enorme não é algo que se deixa para trás.
import * as path from 'path';
import * as vscode from 'vscode';
import { htmlDaWebview, PonteDoHost, type DepsDoPainel } from './ponteDoHost';

export const TIPO_DO_NOTEBOOK = 'braytech.notebook';

export function registrarEditorDeNotebook(deps: DepsDoPainel): vscode.Disposable {
  const provedor: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(documento, painel) {
      painel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'webview')],
      };
      const caminho = documento.uri.fsPath;
      const editor = vscode.workspace.getConfiguration('editor');
      const tema = vscode.window.activeColorTheme.kind;
      const claro = tema === vscode.ColorThemeKind.Light || tema === vscode.ColorThemeKind.HighContrastLight;

      painel.webview.html = htmlDaWebview(painel.webview, deps.extensionUri, 'notebook.js', {
        base: `http://127.0.0.1:${deps.motor.porta}`,
        caminho,
        titulo: path.basename(caminho),
        conteudo: documento.getText(),
        tema: claro ? 'claro' : 'escuro',
        fontSize: editor.get<number>('fontSize') ?? 13,
        tabSize: editor.get<number>('tabSize') ?? 2,
        raiz: vscode.workspace.getWorkspaceFolder(documento.uri)?.uri.fsPath ?? null,
      });

      // A MESMA ponte das outras abas: é por ela que a API chega ao motor.
      new PonteDoHost(deps, () => painel.dispose()).ligar(painel.webview);

      const aoReceber = painel.webview.onDidReceiveMessage((m: { tipo?: string; conteudo?: unknown }) => {
        if (m?.tipo !== 'notebookMudou' || typeof m.conteudo !== 'string') return;
        if (m.conteudo === documento.getText()) return;
        const edicao = new vscode.WorkspaceEdit();
        edicao.replace(
          documento.uri,
          new vscode.Range(documento.positionAt(0), documento.positionAt(documento.getText().length)),
          m.conteudo
        );
        void vscode.workspace.applyEdit(edicao);
      });

      // Desfazer, git, outro editor: a tela relê. As edições DELA também passam
      // aqui, e a tela as reconhece e não repinta.
      const aoMudar = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== documento.uri.toString()) return;
        void painel.webview.postMessage({ tipo: 'novosDados', dados: { conteudo: documento.getText() } });
      });

      painel.onDidDispose(() => {
        aoReceber.dispose();
        aoMudar.dispose();
        void deps.motor.pedir('POST', '/api/notebook/kernel/encerrar', { caminho }).catch(() => undefined);
      });
    },
  };
  return vscode.window.registerCustomEditorProvider(TIPO_DO_NOTEBOOK, provedor, {
    // Trocar de aba e voltar não pode perder a célula em foco nem a rolagem.
    webviewOptions: { retainContextWhenHidden: true },
  });
}
