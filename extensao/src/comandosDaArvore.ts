// Os comandos do menu da árvore que NÃO são ação de driver.
//
// Ele viu na primeira olhada: *"aquelas opções de menu, as opções quando coloca
// o mouse em cima, quando clica, etc não estão aparecendo"*. A entrega
// anterior tinha só as ações que o driver declara — e essas são a minoria do
// que o menu da IDE oferece. Faltavam as três famílias daqui:
//
// - **da conexão**: copiar, conectar/desconectar, recarregar, processos,
//   editar, excluir
// - **do nó**: copiar nome, diagrama ER, diagrama da tabela, nova query
// - **do arquivo remoto**: copiar caminho, novo, renomear, apagar, baixar,
//   executar — o vocabulário próprio da árvore remota (spec 053), onde a ação
//   MEXE no servidor em vez de gerar SQL
//
// **O inventário é FECHADO, e extraído do painel — não lembrado.** Ele disse
// *"estou falando com um disco travado, porque está errando as mesmas coisas
// novamente"*, e tinha razão: eu vinha descobrindo a superfície aos poucos, com
// ele olhando a tela. As 27 afordâncias do `ConnectionsPanel`, do
// `AcoesDaLinhaRemota` e do `AcaoDoImportar` foram listadas de uma vez, e o
// `conferir:extensao` conta as duas listas e falha quando divergem.
//
// Arquivo separado por causa do Artigo IV: emendados no `extension.ts` eles o
// levariam além das 800 linhas, e o assunto aqui é um só.
import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Motor } from './motor';
import type { ArvoreDeConexoes, ItemDaArvore } from './arvore';

/** O que os comandos precisam do resto da extensão. */
export interface DepsDosComandos {
  readonly motor: Motor;
  /** Faz um pedido ao motor mostrando o erro na tela — nunca calado. */
  pedir<T>(metodo: string, rota: string, corpo?: unknown): Promise<T | null>;
  abrirFormulario(conexaoId: string | null, grupo: string, rotulo: string): void;
  abrirAbaDaIde(tipo: string, titulo: string, dados: Record<string, unknown>): void;
  abrirDiagrama(titulo: string, markdown: string): void;
  abrirDialogo(dialogo: 'criacao' | 'filtro', pedido: unknown): void;
  abrirTerminal(connectionId: string, rotulo: string): void;
  /** Baixa/salva um arquivo pela costura de transferência do host. */
  salvarArquivo(nome: string, conteudo: string): Promise<void>;
  abrirQuery(
    connectionId: string,
    database: string | null,
    titulo: string,
    conteudo: string
  ): Promise<void>;
  definirConexaoAtiva(id: string): void;
  recarregarTudo(): void;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** O caminho remoto do item, ou `null` quando ele não é um nó de arquivo. */
function remotoDe(item: ItemDaArvore): string | null {
  const p = item.meta.remotePath;
  return typeof p === 'string' && p !== '' ? p : null;
}

export function registrarComandos(
  contexto: vscode.ExtensionContext,
  deps: DepsDosComandos,
  arvores: readonly ArvoreDeConexoes[]
): void {
  const registrar = (nome: string, fn: (item: ItemDaArvore) => unknown): void => {
    contexto.subscriptions.push(
      vscode.commands.registerCommand(nome, (item: ItemDaArvore) => fn(item))
    );
  };
  const copiar = async (valor: string, o_que: string): Promise<void> => {
    await vscode.env.clipboard.writeText(valor);
    void vscode.window.setStatusBarMessage(`Braytech Code: ${o_que} copiado.`, 2000);
  };
  const rota = (item: ItemDaArvore, sufixo: string): string =>
    `/api/connections/${encodeURIComponent(item.conexao)}${sufixo}`;

  // ---- da conexão ----
  registrar('braytech.copiarNome', (item) =>
    copiar(String(item.label ?? ''), 'nome')
  );

  registrar('braytech.conectar', async (item) => {
    const r = await deps.pedir('POST', rota(item, '/connect'));
    if (r === null) return;
    deps.definirConexaoAtiva(item.conexao);
    deps.recarregarTudo();
  });

  registrar('braytech.desconectar', async (item) => {
    const r = await deps.pedir('POST', rota(item, '/disconnect'));
    if (r === null) return;
    deps.recarregarTudo();
  });

  // Recarregar metadados é `connect` de novo: é o que a IDE faz, e o que
  // devolve a árvore em dia depois de um `CREATE TABLE` feito fora daqui.
  registrar('braytech.recarregarConexao', async (item) => {
    const r = await deps.pedir('POST', rota(item, '/connect'), { refresh: true });
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.verProcessos', (item) => {
    deps.definirConexaoAtiva(item.conexao);
    deps.abrirAbaDaIde('processos', `Processos — ${String(item.label ?? '')}`, {
      connectionId: item.conexao,
      titulo: String(item.label ?? ''),
      somenteLeitura: false,
    });
  });

  registrar('braytech.editarConexao', (item) =>
    deps.abrirFormulario(item.conexao, texto(item.meta.grupo), texto(item.meta.rotulo))
  );

  registrar('braytech.excluirConexao', async (item) => {
    // Modal, e com o nome dentro: apagar conexão apaga a SENHA guardada, e
    // isso não se desfaz com Ctrl+Z.
    const ok = await vscode.window.showWarningMessage(
      `Excluir a conexão "${String(item.label ?? '')}"?`,
      { modal: true, detail: 'A senha guardada no cofre vai junto.' },
      'Excluir'
    );
    if (ok !== 'Excluir') return;
    const r = await deps.pedir('DELETE', rota(item, ''));
    if (r === null) return;
    deps.recarregarTudo();
  });

  // ---- do nó de banco ----
  registrar('braytech.diagramaEr', (item) => abrirEr(deps, item, false));
  registrar('braytech.diagramaDaTabela', (item) => abrirEr(deps, item, true));

  for (const [nome, extensao] of [
    ['braytech.novaQuerySql', '.sql'],
    ['braytech.novoQueryBook', '.sqlbook'],
  ] as const) {
    registrar(nome, async (item) => {
      const base = await vscode.window.showInputBox({
        prompt: `Nome do arquivo (${extensao})`,
        value: `consulta${extensao}`,
        ignoreFocusOut: true,
      });
      if (base === undefined || base.trim() === '') return;
      const nomeFinal = base.endsWith(extensao) ? base : `${base}${extensao}`;
      const database = texto(item.meta.database);
      const r = await deps.pedir<{ path: string }>('POST', '/api/queries', {
        connectionId: item.conexao,
        database,
        name: nomeFinal,
        content: '',
      });
      if (r === null) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(r.path));
      await vscode.window.showTextDocument(doc);
      deps.recarregarTudo();
    });
  }

  // ---- do arquivo remoto (spec 053) ----
  registrar('braytech.copiarCaminho', (item) => {
    const p = remotoDe(item);
    if (p !== null) void copiar(p, 'caminho');
  });

  registrar('braytech.novoArquivoRemoto', (item) => criarRemoto(deps, item, 'arquivo'));
  registrar('braytech.novaPastaRemota', (item) => criarRemoto(deps, item, 'pasta'));

  registrar('braytech.renomearRemoto', async (item) => {
    const antigo = remotoDe(item);
    if (antigo === null) return;
    const nome = await vscode.window.showInputBox({
      prompt: 'Novo nome',
      value: path.posix.basename(antigo),
      ignoreFocusOut: true,
    });
    if (nome === undefined || nome.trim() === '') return;
    const destino = path.posix.join(path.posix.dirname(antigo), nome.trim());
    const r = await deps.pedir('POST', rota(item, '/files/rename'), { from: antigo, to: destino });
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.apagarRemoto', async (item) => {
    const alvo = remotoDe(item);
    if (alvo === null) return;
    const ok = await vscode.window.showWarningMessage(
      `Apagar "${alvo}" no servidor?`,
      { modal: true, detail: 'Não há lixeira do outro lado.' },
      'Apagar'
    );
    if (ok !== 'Apagar') return;
    const r = await deps.pedir('DELETE', rota(item, `/files?path=${encodeURIComponent(alvo)}`));
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.baixarRemoto', async (item) => {
    const alvo = remotoDe(item);
    if (alvo === null) return;
    const onde = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.posix.basename(alvo)),
      saveLabel: 'Baixar',
    });
    if (onde === undefined) return;
    try {
      const bytes = await deps.motor.pedirBytes(
        'GET',
        rota(item, `/files/bytes?path=${encodeURIComponent(alvo)}`)
      );
      await vscode.workspace.fs.writeFile(onde, bytes);
      void vscode.window.showInformationMessage(`Braytech Code: baixado em ${onde.fsPath}`);
    } catch (erro) {
      void vscode.window.showErrorMessage(
        `Braytech Code: ${erro instanceof Error ? erro.message : String(erro)}`
      );
    }
  });

  registrar('braytech.executarRemoto', async (item) => {
    const alvo = remotoDe(item);
    if (alvo === null) return;
    // Pergunta antes, e mostra o comando: isto RODA na máquina dele.
    const ok = await vscode.window.showWarningMessage(
      `Executar "${alvo}" no servidor?`,
      { modal: true, detail: 'O comando roda com o usuário da conexão.' },
      'Executar'
    );
    if (ok !== 'Executar') return;
    const r = await deps.pedir<{ output: string; code: number }>(
      'POST',
      rota(item, '/files/execute'),
      { path: alvo }
    );
    if (r === null) return;
    const doc = await vscode.workspace.openTextDocument({
      content: `$ ${alvo}\n(código ${r.code})\n\n${r.output}`,
    });
    await vscode.window.showTextDocument(doc);
  });

  // ---- da BARRA DO TOPO (view/title) ----
  //
  // Sete ícones no painel da IDE, e nenhum deles existia aqui. `Recolher tudo`
  // não entra na lista: o `showCollapseAll` da `TreeView` já o desenha.
  const semItem = (fn: () => unknown): ((item: ItemDaArvore) => unknown) => () => fn();

  registrar('braytech.trocarSenhaMestra', semItem(async () => {
    const atual = await vscode.window.showInputBox({
      prompt: 'Senha-mestra ATUAL', password: true, ignoreFocusOut: true,
    });
    if (atual === undefined || atual === '') return;
    const nova = await vscode.window.showInputBox({
      prompt: 'Senha-mestra NOVA', password: true, ignoreFocusOut: true,
    });
    if (nova === undefined || nova === '') return;
    const confirma = await vscode.window.showInputBox({
      prompt: 'Repita a senha NOVA', password: true, ignoreFocusOut: true,
    });
    // Confere ANTES de mandar: senha trocada com erro de digitação tranca o
    // cofre dele para sempre, e não há como desfazer.
    if (confirma !== nova) {
      void vscode.window.showErrorMessage('Braytech Code: as senhas não conferem.');
      return;
    }
    const r = await deps.pedir('POST', '/api/connections/vault/password', {
      current: atual, next: nova,
    });
    if (r === null) return;
    void vscode.window.showInformationMessage('Braytech Code: senha-mestra trocada.');
  }));

  registrar('braytech.exportarConexoes', semItem(async () => {
    // O aviso é o mesmo da IDE, e a palavra que importa está no rótulo do
    // botão: o arquivo sai com as SENHAS em claro.
    const ok = await vscode.window.showWarningMessage(
      'Exportar as conexões COM as senhas em claro?',
      { modal: true, detail: 'Qualquer um que abrir o arquivo lê as senhas.' },
      'Exportar'
    );
    if (ok !== 'Exportar') return;
    const r = await deps.pedir<unknown>('POST', '/api/connections/export-all', {});
    if (r === null) return;
    await deps.salvarArquivo('conexoes-braytech.json', JSON.stringify(r, null, 2));
  }));

  registrar('braytech.importarConexoes', semItem(async () => {
    const escolhidos = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ['json'] },
      openLabel: 'Importar',
    });
    const arquivo = escolhidos?.[0];
    if (arquivo === undefined) return;
    const bytes = await vscode.workspace.fs.readFile(arquivo);
    let conteudo: unknown;
    try {
      conteudo = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      void vscode.window.showErrorMessage('Braytech Code: o arquivo não é um JSON válido.');
      return;
    }
    const r = await deps.pedir('POST', '/api/connections/import', conteudo);
    if (r === null) return;
    deps.recarregarTudo();
    void vscode.window.showInformationMessage('Braytech Code: conexões importadas.');
  }));

  registrar('braytech.alternarCofre', semItem(async () => {
    const raiz = await deps.pedir<{ vault: { unlocked: boolean } }>('GET', '/api/connections');
    if (raiz === null) return;
    if (raiz.vault.unlocked) {
      const r = await deps.pedir('POST', '/api/connections/vault/lock', {});
      if (r === null) return;
      deps.recarregarTudo();
      return;
    }
    await vscode.commands.executeCommand('braytech.destrancarCofre');
  }));

  // ---- do GRUPO ----
  registrar('braytech.renomearGrupo', async (item) => {
    const antigo = item.grupo;
    const nome = await vscode.window.showInputBox({
      prompt: 'Novo nome do grupo',
      value: antigo.split('/').pop() ?? antigo,
      ignoreFocusOut: true,
    });
    if (nome === undefined || nome.trim() === '') return;
    const pai = antigo.includes('/') ? `${antigo.slice(0, antigo.lastIndexOf('/'))}/` : '';
    const r = await deps.pedir('POST', '/api/connections/groups/rename', {
      from: antigo, to: `${pai}${nome.trim()}`,
    });
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.novaConexaoNoGrupo', (item) => deps.abrirFormulario(null, item.grupo, ''));

  // ---- da CONEXÃO (hover) ----
  registrar('braytech.abrirServidorDaConexao', (item) => {
    deps.definirConexaoAtiva(item.conexao);
    deps.abrirAbaDaIde('servidor', String(item.label ?? ''), {
      connectionId: item.conexao,
      rotulo: String(item.label ?? ''),
      somenteLeitura: false,
    });
  });

  registrar('braytech.abrirTerminalDaConexao', (item) =>
    deps.abrirTerminal(item.conexao, String(item.label ?? ''))
  );

  // ---- do NÓ (hover) ----
  registrar('braytech.abrirQueryNoDatabase', (item) => {
    deps.definirConexaoAtiva(item.conexao);
    void deps.abrirQuery(item.conexao, texto(item.meta.database), 'Nova consulta', '');
  });

  registrar('braytech.criarObjeto', (item) =>
    deps.abrirDialogo('criacao', {
      connectionId: item.conexao,
      nodePath: item.nodePath,
      template: texto(item.meta.template),
      rotulo: String(item.label ?? ''),
    })
  );

  registrar('braytech.filtrarCategoria', (item) =>
    deps.abrirDialogo('filtro', {
      connectionId: item.conexao,
      nodePath: item.nodePath,
      rotulo: String(item.label ?? ''),
    })
  );

  // ---- do arquivo de QUERY (hover) ----
  registrar('braytech.renomearQuery', async (item) => {
    const caminho = texto(item.meta.arquivo);
    if (caminho === '') return;
    const nome = await vscode.window.showInputBox({
      prompt: 'Novo nome', value: path.basename(caminho), ignoreFocusOut: true,
    });
    if (nome === undefined || nome.trim() === '') return;
    const r = await deps.pedir('POST', '/api/queries/rename', { path: caminho, name: nome.trim() });
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.apagarQuery', async (item) => {
    const caminho = texto(item.meta.arquivo);
    if (caminho === '') return;
    const ok = await vscode.window.showWarningMessage(
      `Apagar "${path.basename(caminho)}"?`, { modal: true }, 'Apagar'
    );
    if (ok !== 'Apagar') return;
    const r = await deps.pedir('DELETE', `/api/queries?path=${encodeURIComponent(caminho)}`);
    if (r === null) return;
    deps.recarregarTudo();
  });

  // ---- do arquivo REMOTO (hover) ----
  registrar('braytech.favoritarRemoto', async (item) => {
    const alvo = remotoDe(item);
    if (alvo === null) return;
    const r = await deps.pedir('POST', rota(item, '/files/favorites'), { path: alvo });
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.recarregarNo', () => deps.recarregarTudo());

  // Um comando para cada árvore não faz sentido: recarregar é global, e ele
  // não sabe (nem precisa saber) em qual das duas clicou.
  void arvores;
}

async function abrirEr(
  deps: DepsDosComandos,
  item: ItemDaArvore,
  daTabela: boolean
): Promise<void> {
  const rotulo = String(item.label ?? '');
  const busca = new URLSearchParams();
  for (const p of item.nodePath) busca.append('path', p);
  const r = await deps.pedir<{ markdown: string }>(
    'GET',
    `/api/connections/${encodeURIComponent(item.conexao)}/er?${busca.toString()}`
  );
  if (r === null) return;
  deps.abrirDiagrama(daTabela ? `${rotulo} e vizinhos` : rotulo, r.markdown);
}

async function criarRemoto(
  deps: DepsDosComandos,
  item: ItemDaArvore,
  tipo: 'arquivo' | 'pasta'
): Promise<void> {
  const pasta = remotoDe(item);
  if (pasta === null) return;
  const nome = await vscode.window.showInputBox({
    prompt: `Nome ${tipo === 'pasta' ? 'da pasta' : 'do arquivo'}`,
    ignoreFocusOut: true,
  });
  if (nome === undefined || nome.trim() === '') return;
  const destino = path.posix.join(pasta, nome.trim());
  const r = await deps.pedir(
    'POST',
    `/api/connections/${encodeURIComponent(item.conexao)}/files${tipo === 'pasta' ? '/mkdir' : ''}`,
    { path: destino }
  );
  if (r === null) return;
  deps.recarregarTudo();
}
