// Braytech Code dentro do VS Code e do Cursor.
//
// **A barra lateral é ÁRVORE NATIVA do editor** (`arvore.ts`): ícone que segue
// o tema dele, menu de botão direito de verdade, ícones ao passar o mouse e
// soltura de arquivo vinda do sistema — que é o gesto que a webview nunca pôde
// receber (microsoft/vscode#111092).
//
// Houve uma tentativa anterior de árvore nativa, e ele a derrubou em minutos:
// ícone traduzido à mão que não batia, menu de contexto virando lista de
// opções, hover sem ação nenhuma. A troca só se sustenta porque nada disso é
// escrito à mão: o ícone vem do mapa de codicons, o menu é GERADO das ações
// que o driver declara, e um arnês percorre uma árvore de verdade e falha
// quando alguma afordância some.
//
// Entre 04/09 e 08/09 a árvore conviveu com as webviews de painel, lado a
// lado, para ele comparar. Em 08/09 ele olhou e disse *"pode remover o
// antigo"* — e elas saíram. O que continua sendo webview são as ABAS, onde a
// IDE de verdade roda dentro do editor: grade, chave, servidor, processos,
// caderno, diagrama, formulário de conexão e os diálogos.
//
// A extensão em si faz três coisas: sobe o motor, abre o que a árvore pedir, e
// executa `.sql` com Ctrl+Enter.
import * as vscode from 'vscode';
import { ArquivosRemotos, uriRemota } from './arquivosRemotos';
import { ligarMotor, type Motor } from './motor';
import {
  abrirAbaDaIde, abrirDiagramaEmAba, abrirDialogoEmAba, abrirFormularioDeConexao,
} from './formularioAba';
import { ArvoreDeConexoes, definirRecursos, type ItemDaArvore } from './arvore';
import { ACOES_DO_MENU, comandoDaAcao } from './acoesDoMenu';
import type { FiltroDaArvore } from './filtro-da-arvore';
import { registrarComandos } from './comandosDaArvore';
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
    recarregarPaineis: (conexaoId, caminho, filtro) => {
      // **As ÁRVORES.** O diálogo de filtro devolve a escolha por
      // esta mensagem; sem esta linha ele guardava e a árvore continuava
      // mostrando as 95 tabelas. Era o "filtro de tables não está sendo
      // aplicado" — o diálogo funcionava, e ninguém escutava a resposta.
      if (
        filtro !== undefined &&
        filtro !== null &&
        caminho !== undefined &&
        conexaoId !== undefined
      ) {
        void Promise.all(
          arvores.map((a) => a.aplicarFiltro(conexaoId, caminho, filtro as FiltroDaArvore))
        );
        return;
      }
      recarregarArvores();
    },
  };

  // **As árvores NATIVAS da barra lateral (spec 104).**
  //
  // Conviveram por uma entrega com as webviews antigas, de propósito: em 04/09
  // ele derrubou a árvore nativa por quatro motivos concretos, e a única forma
  // honesta de saber se eles voltaram era ele ver as duas na mesma tela. Em
  // 08/09 ele olhou e disse *"pode remover o antigo"* — e por isso a webview de
  // painel saiu. As abas (formulário, diálogo, grade, caderno, diagrama)
  // continuam sendo webview, e não mudaram.
  definirRecursos(vscode.Uri.joinPath(contexto.extensionUri, 'recursos'));
  const arvores: ArvoreDeConexoes[] = [];
  for (const [painel, view] of [
    ['database', 'braytech.databases.arvore'],
    ['service', 'braytech.servicos.arvore'],
  ] as const) {
    const arvore = new ArvoreDeConexoes(motor, painel as Painel);
    arvores.push(arvore);
    contexto.subscriptions.push(
      vscode.window.createTreeView<ItemDaArvore>(view, {
        treeDataProvider: arvore,
        // É isto que abre a porta que a webview não tem: soltura de arquivo
        // vindo do sistema (microsoft/vscode#111092).
        dragAndDropController: arvore,
        showCollapseAll: true,
      })
    );
  }
  const recarregarArvores = (): void => {
    for (const a of arvores) a.recarregar();
  };

  // Os comandos do menu que NÃO são ação de driver — conexão, nó e arquivo
  // remoto. Ver `comandosDaArvore.ts` para o porquê de estarem lá.
  registrarComandos(
    contexto,
    {
      motor,
      pedir,
      abrirFormulario: (id, grupo, rotulo) => abrirFormularioDeConexao(deps, id, grupo, rotulo),
      abrirAbaDaIde: (tipo, titulo, dados) =>
        deps.abrirAbaDaIde(tipo as Parameters<typeof deps.abrirAbaDaIde>[0], titulo, dados),
      abrirDiagrama: (titulo, markdown) => deps.abrirDiagrama(titulo, markdown),
      abrirDialogo: (dialogo, pedido) => deps.abrirDialogo(dialogo, pedido),
      abrirTerminal: (id, rotulo) => deps.abrirTerminal(id, rotulo),
      salvarArquivo: async (nome, conteudo) => {
        const onde = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(nome),
          saveLabel: 'Salvar',
        });
        if (onde === undefined) return;
        await vscode.workspace.fs.writeFile(onde, Buffer.from(conteudo, 'utf8'));
        void vscode.window.showInformationMessage(`Braytech Code: salvo em ${onde.fsPath}`);
      },
      abrirQuery: (id, database, titulo, conteudo) =>
        deps.abrirQuery(id, database, titulo, conteudo),
      definirConexaoAtiva,
      // Sem a webview de painel, recarregar é recarregar as ÁRVORES: mandar o
      // editor recarregar webview aqui redesenharia as ABAS abertas dele —
      // grade, caderno, diagrama — e jogaria fora o que estivesse na tela.
      recarregarTudo: recarregarArvores,
    },
    arvores
  );

  contexto.subscriptions.push(
    vscode.commands.registerCommand('braytech.enviarArquivos', async (item: ItemDaArvore) => {
      const arvore = arvores[0];
      if (arvore === undefined) return;
      // Qualquer uma serve para SUBIR — o caminho é o motor, não a árvore. Quem
      // redesenha são as duas, porque daqui não dá para saber de qual veio o
      // item, e pedir ao editor que redesenhe um nó de outra árvore não faz nada.
      await arvore.enviarEscolhidos(item);
      recarregarArvores();
    })
  );

  // **Uma ação do driver = um comando.** O que ela FAZ continua sendo do
  // driver: aqui só se chama a rota e se usa a resposta — copiar, ou abrir a
  // query. Nenhum SQL é escrito neste arquivo (spec 040, e o Artigo III).
  for (const acao of ACOES_DO_MENU) {
    contexto.subscriptions.push(
      vscode.commands.registerCommand(comandoDaAcao(acao.id), async (item: ItemDaArvore) => {
        const r = await pedir<{ title: string; content: string }>(
          'POST',
          `/api/connections/${encodeURIComponent(item.conexao)}/action`,
          { nodePath: item.nodePath, actionId: acao.id }
        );
        if (r === null) return;
        const declarada = item.acoes.find((a) => a.id === acao.id);
        if (declarada?.copiar === true) {
          // Vai para a área de transferência, e não para uma aba: é texto para
          // colar num `.sql` dele. Escolha DELE na P3, em 02/09.
          await vscode.env.clipboard.writeText(r.content);
          void vscode.window.showInformationMessage(`Braytech Code: ${r.title} copiado.`);
          return;
        }
        // **Do item, herdado do pai.** Uma procedure não repete o
        // `meta.database`: lendo só do próprio nó, o que chegava à rota era
        // vazio — *"Campo obrigatório ausente ou inválido: database"*.
        definirConexaoAtiva(item.conexao);
        await deps.abrirQuery(item.conexao, item.banco, r.title, r.content);
      })
    );
  }

  barra = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  barra.command = 'braytech.recarregar';
  atualizarBarra();
  barra.show();
  contexto.subscriptions.push(barra);

  contexto.subscriptions.push(
    vscode.commands.registerCommand('braytech.recarregar', recarregarArvores),

    vscode.commands.registerCommand('braytech.destrancarCofre', async () => {
      // O cofre também se destranca pelo cadeado da barra da árvore. Este
      // comando existe para a paleta, que é onde se procura por nome.
      const senha = await vscode.window.showInputBox({
        prompt: 'Senha-mestra do cofre da Braytech Code',
        password: true,
        ignoreFocusOut: true,
      });
      if (senha === undefined || senha === '') return;
      const ok = await pedir('POST', '/api/connections/vault/unlock', { password: senha });
      if (ok === null) return;
      recarregarArvores();
      void vscode.window.showInformationMessage('Braytech Code: cofre destrancado.');
    }),

    // **Clicar num nó de dado abre a grade DA IDE** — não uma <table> montada
    // aqui. Foi um dos quatro motivos de ele derrubar a árvore nativa em 04/09:
    // a prévia de antes não tinha ordenação, paginação nem visor de célula.
    vscode.commands.registerCommand('braytech.abrirNo', (item: ItemDaArvore) => {
      const database = item.banco ?? '';
      definirConexaoAtiva(item.conexao);
      deps.abrirAbaDaIde('tabela', item.label === undefined ? '' : String(item.label), {
        connectionId: item.conexao,
        nodePath: item.nodePath,
        database,
        // **Do ITEM.** Com `false` fixo a grade nascia EDITÁVEL numa conexão
        // somente-leitura — exatamente o defeito que a spec 096 já tinha
        // registrado no visor de chave, e que eu repeti aqui.
        somenteLeitura: item.trancada,
      });
    }),

    // **SSH que abre arquivo** — outro dos quatro. A URI `braytech:` é servida
    // pelo `ArquivosRemotos`, então abre EDITÁVEL e o Ctrl+S grava no servidor.
    vscode.commands.registerCommand(
      'braytech.abrirArquivoRemoto',
      async (item: ItemDaArvore) => {
        const caminho = item.meta.remotePath;
        if (typeof caminho !== 'string') return;
        // **`vscode.open`, e não `openTextDocument`.** Aquele abre TUDO como
        // texto, e uma imagem morria em *"File seems to be binary and cannot be
        // opened as text"* (ele, 08/09/2026). Este deixa o editor escolher —
        // prévia para imagem, editor de texto para texto —, que é o que o
        // Explorer dele já faz com arquivo local.
        await vscode.commands.executeCommand(
          'vscode.open',
          uriRemota(item.conexao, caminho)
        );
      }
    ),

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
