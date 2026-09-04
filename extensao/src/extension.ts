// Braytech Code dentro do VS Code e do Cursor — prova de conceito.
//
// A pergunta que ela responde é uma só: **quanto do projeto sobrevive à troca
// de casca?** A resposta, medida no que está aqui:
//
// - o motor (drivers, cofre, pool, rotas) não mudou UMA LINHA;
// - a árvore virou a árvore nativa do editor, sem webview;
// - a grade precisou de uma webview, e é o único desenho reescrito.
//
// O que o VS Code passa a dar de graça: editor, abas, árvore de arquivos,
// vigia de disco, busca, símbolos, arquivo grande, caminho do Windows,
// empacotamento, atualização e Remote-SSH. Foi onde moraram todos os defeitos
// das specs 090 e 091.

import * as vscode from 'vscode';
import { ArvoreDeConexoes, type ItemDaArvore } from './arvore';
import { mostrarResultado, type ResultadoDoMotor } from './grade';
import { ligarMotor, type Motor } from './motor';

/** A conexão em que as consultas rodam. Escolhida clicando na árvore. */
let conexaoAtiva: string | null = null;
let barra: vscode.StatusBarItem | null = null;

export async function activate(contexto: vscode.ExtensionContext): Promise<void> {
  const conf = vscode.workspace.getConfiguration('braytech');
  const porta = conf.get<number>('porta') ?? 4321;

  let motor: Motor;
  try {
    motor = await ligarMotor(porta, conf.get<string>('motor') ?? '');
  } catch (erro) {
    // Sem motor não há extensão. Dizer isso uma vez, claro, é melhor que
    // deixar cada comando falhar depois com uma mensagem de rede.
    void vscode.window.showErrorMessage(
      `Braytech Code: não consegui subir o motor na porta ${porta}. ${mensagem(erro)}`
    );
    return;
  }

  const arvore = new ArvoreDeConexoes(motor);
  contexto.subscriptions.push(
    vscode.window.createTreeView('braytech.conexoes', { treeDataProvider: arvore })
  );

  barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  barra.command = 'braytech.recarregar';
  atualizarBarra();
  barra.show();
  contexto.subscriptions.push(barra);

  contexto.subscriptions.push(
    vscode.commands.registerCommand('braytech.recarregar', () => arvore.recarregar()),

    vscode.commands.registerCommand('braytech.destrancarCofre', async () => {
      const senha = await vscode.window.showInputBox({
        prompt: 'Senha-mestra do cofre da Braytech Code',
        password: true,
        ignoreFocusOut: true,
      });
      if (senha === undefined || senha === '') return;
      try {
        await motor.pedir('POST', '/api/connections/vault/unlock', { password: senha });
        arvore.recarregar();
        void vscode.window.showInformationMessage('Braytech Code: cofre destrancado.');
      } catch (erro) {
        void vscode.window.showErrorMessage(`Braytech Code: ${mensagem(erro)}`);
      }
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
          'Braytech Code: escolha uma conexão na árvore antes de executar.'
        );
        return;
      }
      // A seleção manda quando existe: rodar o arquivo inteiro quando o usuário
      // marcou três linhas seria fazer outra coisa do que ele pediu.
      const selecao = editor.document.getText(editor.selection);
      const sql = selecao.trim() === '' ? editor.document.getText() : selecao;
      if (sql.trim() === '') return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Braytech Code: executando…' },
        async () => {
          try {
            const r = await motor.pedir<ResultadoDoMotor>(
              'POST',
              `/api/connections/${encodeURIComponent(conexaoAtiva as string)}/execute`,
              { statement: sql }
            );
            mostrarResultado(r, conexaoAtiva as string);
          } catch (erro) {
            void vscode.window.showErrorMessage(`Braytech Code: ${mensagem(erro)}`);
          }
        }
      );
    }),

    // Clicar num nó da árvore escolhe a conexão em que o Ctrl+Enter roda.
    vscode.commands.registerCommand('braytech.escolher', (item: ItemDaArvore) => {
      conexaoAtiva = item.conexao;
      atualizarBarra();
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
