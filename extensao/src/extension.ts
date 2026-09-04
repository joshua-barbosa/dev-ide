// Braytech Code dentro do VS Code e do Cursor — prova de conceito.
//
// Duas árvores, `Databases` e `Services`, como na IDE própria; quem separa é o
// `panel` que o DRIVER declara. Clicar numa folha mostra as linhas; o menu de
// contexto oferece o que o driver declarou em `actions`, e nada além.
//
// O motor (drivers, cofre, pool, rotas) não mudou uma linha para nada disto.

import * as vscode from 'vscode';
import { ArvoreDeConexoes, type AcaoDoNo, type ItemDaArvore } from './arvore';
import { mostrarResultado, mostrarTexto, type ResultadoDoMotor } from './grade';
import { ligarMotor, type Motor } from './motor';
import type { Painel } from './paineis';

/** A conexão em que as consultas rodam. Vem da seleção na árvore. */
let conexaoAtiva: string | null = null;
let barra: vscode.StatusBarItem | null = null;

/** Linhas por página na prévia de uma tabela. */
const POR_PAGINA = 200;

/** `TablePage` do motor. */
interface PaginaDeTabela {
  readonly resultado: ResultadoDoMotor;
  readonly total: number | null;
  readonly totalEstimado: number | null;
  readonly sql: string;
}

/** `ActionResult` do motor. */
interface ResultadoDeAcao {
  readonly kind: 'statement' | 'text';
  readonly title: string;
  readonly content: string;
  readonly language?: string;
}

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
    // deixar cada comando falhar depois com uma mensagem de rede.
    void vscode.window.showErrorMessage(
      `Braytech Code: não consegui subir o motor na porta ${porta}. ${mensagem(erro)}`
    );
    return;
  }

  const arvores = new Map<Painel, ArvoreDeConexoes>();
  for (const [painel, view] of [
    ['database', 'braytech.databases'],
    ['service', 'braytech.servicos'],
  ] as const) {
    const arvore = new ArvoreDeConexoes(motor, painel);
    arvores.set(painel, arvore);
    const vista = vscode.window.createTreeView(view, { treeDataProvider: arvore });
    // **A seleção marca a conexão ativa, e não um `command` no item.** Um
    // `TreeItem` com comando executa o comando em vez de expandir — era o que
    // fazia a árvore não abrir ao clicar numa conexão.
    vista.onDidChangeSelection((e) => {
      const item = e.selection[0];
      if (item === undefined || item.conexao === '') return;
      conexaoAtiva = item.conexao;
      atualizarBarra();
    });
    contexto.subscriptions.push(vista);
  }
  const recarregarTudo = (): void => arvores.forEach((a) => a.recarregar());

  barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  barra.command = 'braytech.recarregar';
  atualizarBarra();
  barra.show();
  contexto.subscriptions.push(barra);

  const pedir = async <T>(metodo: string, rota: string, corpo?: unknown): Promise<T | null> => {
    try {
      return await motor.pedir<T>(metodo, rota, corpo);
    } catch (erro) {
      void vscode.window.showErrorMessage(`Braytech Code: ${mensagem(erro)}`);
      return null;
    }
  };

  contexto.subscriptions.push(
    vscode.commands.registerCommand('braytech.recarregar', recarregarTudo),

    vscode.commands.registerCommand('braytech.destrancarCofre', async () => {
      const senha = await vscode.window.showInputBox({
        prompt: 'Senha-mestra do cofre da Braytech Code',
        password: true,
        ignoreFocusOut: true,
      });
      if (senha === undefined || senha === '') return;
      const ok = await pedir('POST', '/api/connections/vault/unlock', { password: senha });
      if (ok === null) return;
      recarregarTudo();
      void vscode.window.showInformationMessage('Braytech Code: cofre destrancado.');
    }),

    /**
     * Abre um `.sql` ou `.sqlbook` da pasta `Query` no editor.
     *
     * Como ARQUIVO de verdade, e não como texto solto numa aba sem nome: é o
     * mesmo arquivo em disco que a IDE própria abre, então salvar aqui e abrir
     * lá dá a mesma coisa.
     */
    vscode.commands.registerCommand('braytech.abrirArquivoDeQuery', async (item: ItemDaArvore) => {
      conexaoAtiva = item.conexao;
      atualizarBarra();
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.arquivo));
        await vscode.window.showTextDocument(doc);
        if (item.arquivo.endsWith('.sqlbook')) {
          // Dizer antes de ele descobrir sozinho: o caderno abre como TEXTO.
          // Desenhá-lo como caderno pede a API de Notebook do editor, que é
          // trabalho de tamanho próprio e ainda não foi feito.
          void vscode.window.showInformationMessage(
            'O .sqlbook abre como texto por enquanto — o caderno ainda não é desenhado aqui.'
          );
        }
      } catch (erro) {
        void vscode.window.showErrorMessage(`Braytech Code: ${mensagem(erro)}`);
      }
    }),

    vscode.commands.registerCommand('braytech.novaConsulta', async () => {
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: '' });
      await vscode.window.showTextDocument(doc);
    }),

    /** Clique numa folha da árvore: as linhas dela. */
    vscode.commands.registerCommand('braytech.abrirNo', async (item: ItemDaArvore) => {
      conexaoAtiva = item.conexao;
      atualizarBarra();
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Braytech Code: ${item.label}…` },
        async () => {
          // `/table` devolve uma PÁGINA (`TablePage`), e não um `QueryResult`
          // solto: ela traz o total real e o SQL que rodou. O total é o que
          // permite dizer "200 de 41.312" em vez de deixar o corte implícito.
          const r = await pedir<PaginaDeTabela>(
            'POST',
            `/api/connections/${encodeURIComponent(item.conexao)}/table`,
            { nodePath: item.nodePath, pagina: 1, porPagina: POR_PAGINA }
          );
          if (r !== null) {
            mostrarResultado(r.resultado, String(item.label), {
              total: r.total,
              totalEstimado: r.totalEstimado,
              sql: r.sql,
            });
          }
        }
      );
    }),

    /**
     * O menu do nó — o que o DRIVER declarou, e nada além.
     *
     * Um item de menu por ação exigiria conhecer as ações no `package.json`, que
     * é estático. A escolha rápida resolve isso sem a extensão inventar
     * nenhuma: ela mostra o que veio no `actions` daquele nó.
     */
    vscode.commands.registerCommand('braytech.acoesDoNo', async (item: ItemDaArvore) => {
      if (item.acoes.length === 0) {
        void vscode.window.showInformationMessage('Este nó não tem ações.');
        return;
      }
      const escolha = await vscode.window.showQuickPick(
        item.acoes.map((a: AcaoDoNo) => ({
          label: a.danger === true ? `$(warning) ${a.label}` : a.label,
          acao: a,
        })),
        { placeHolder: String(item.label) }
      );
      if (escolha === undefined) return;

      if (escolha.acao.danger === true) {
        const confirma = await vscode.window.showWarningMessage(
          `“${escolha.acao.label}” em ${String(item.label)}?`,
          { modal: true },
          'Continuar'
        );
        if (confirma !== 'Continuar') return;
      }

      const r = await pedir<ResultadoDeAcao>(
        'POST',
        `/api/connections/${encodeURIComponent(item.conexao)}/action`,
        { nodePath: item.nodePath, actionId: escolha.acao.id }
      );
      if (r === null) return;

      // Ação de COPIAR vai para a área de transferência — decisão dele sobre o
      // SQL de usuário e permissão: o texto é para colar num `.sql`, não para
      // virar mais uma aba a fechar.
      if (escolha.acao.copiar === true) {
        await vscode.env.clipboard.writeText(r.content);
        void vscode.window.showInformationMessage(`${r.title} copiado.`);
        return;
      }
      mostrarTexto(r.content, r.title, r.language ?? 'sql');
      recarregarTudo();
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

      const alvo = conexaoAtiva;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Braytech Code: executando…' },
        async () => {
          const r = await pedir<ResultadoDoMotor>(
            'POST',
            `/api/connections/${encodeURIComponent(alvo)}/execute`,
            { statement: sql }
          );
          if (r !== null) mostrarResultado(r, alvo);
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
