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
import { documentoDoDiagrama, type DiagramaER } from './diagrama-er';

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

/**
 * Abre um arquivo de query — e `.sqlbook` NÃO é texto.
 *
 * Ele viu: *".sqlbook abre como JSON e não igual o outro"*. O caderno tem
 * formato próprio, e mostrado como texto vira o JSON cru. A IDE manda
 * `abrirCaderno`, com o VÍNCULO junto: sem ele o bloco de SQL não teria contra
 * quem rodar.
 */
async function abrirArquivoDeQuery(
  deps: DepsDosComandos,
  caminho: string,
  connectionId: string,
  database: string
): Promise<void> {
  if (caminho.endsWith('.sqlbook')) {
    deps.abrirAbaDaIde('caderno', caminho.split('/').pop() ?? 'Caderno', {
      caminho,
      connectionId,
      database,
    });
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(caminho));
  await vscode.window.showTextDocument(doc);
}

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
    // `connect` puro: a rota não tem `refresh`, e mandar um campo que ela
    // ignora dava a impressão de recarregar sem recarregar.
    const r = await deps.pedir('POST', rota(item, '/connect'));
    if (r === null) return;
    deps.recarregarTudo();
  });

  registrar('braytech.verProcessos', (item) => {
    deps.definirConexaoAtiva(item.conexao);
    deps.abrirAbaDaIde('processos', `Processos — ${String(item.label ?? '')}`, {
      // **`conexaoId`, não `connectionId`.** É o nome que a WEBVIEW da aba lê
      // (`aba.tsx`), e a ponte do painel já traduzia — eu não. O id chegava
      // vazio e virava `/api/connections//key`, que foi o que ele viu.
      conexaoId: item.conexao,
      titulo: String(item.label ?? ''),
      // **Do ITEM, nunca `false` fixo.** Matar processo MUDA o servidor, e a
      // rota recusa — mas oferecer o botão faz o clique parecer defeito.
      somenteLeitura: item.trancada,
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

  // **O `+` da pasta Query PERGUNTA o que criar.**
  //
  // Ele: *"quando clica para adicionar algum novo no Query ele também não
  // pergunta se é SQL ou SQLBOOK"*. A IDE pergunta — `acoes.ts`, `novaQuery` —
  // e o rótulo dela diz por quê: *"um `+` que não diz o que acrescenta só serve
  // para quem já sabe"*. Eu tinha amarrado o botão em `.sql`.
  const criarQuery = async (item: ItemDaArvore, tipo?: 'sql' | 'sqlbook'): Promise<void> => {
    const escolhido =
      tipo ??
      (
        await vscode.window.showQuickPick(
          [
            { label: 'Query SQL', detail: 'Um arquivo .sql', valor: 'sql' as const },
            { label: 'Caderno', detail: 'Um .sqlbook, com blocos', valor: 'sqlbook' as const },
          ],
          { placeHolder: 'O que criar nesta conexão?' }
        )
      )?.valor;
    if (escolhido === undefined) return;

    const extensao = escolhido === 'sqlbook' ? '.sqlbook' : '.sql';
    const base = await vscode.window.showInputBox({
      prompt: 'Nome do arquivo',
      value: `consulta${extensao}`,
      ignoreFocusOut: true,
    });
    if (base === undefined || base.trim() === '') return;
    const nomeFinal = base.trim().endsWith(extensao) ? base.trim() : `${base.trim()}${extensao}`;
    const database = item.banco ?? '';
    // `nome`, e não `name`/`content`: os campos da rota, conferidos no
    // `Api.createQuery`.
    const r = await deps.pedir<{ caminho: string }>('POST', '/api/queries', {
      connectionId: item.conexao,
      database,
      nome: nomeFinal,
    });
    if (r === null) return;
    await abrirArquivoDeQuery(deps, r.caminho, item.conexao, database);
    deps.recarregarTudo();
  };

  registrar('braytech.novaQuery', (item) => criarQuery(item));
  registrar('braytech.novaQuerySql', (item) => criarQuery(item, 'sql'));
  registrar('braytech.novoQueryBook', (item) => criarQuery(item, 'sqlbook'));

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
    // A rota devolve `{ stdout, stderr, code }` — não um `output` só, que era
    // o que eu lia. Com o campo errado a saída vinha sempre vazia.
    const r = await deps.pedir<{ stdout: string; stderr: string; code: number | null }>(
      'POST',
      rota(item, '/files/execute'),
      { path: alvo }
    );
    if (r === null) return;
    const doc = await vscode.workspace.openTextDocument({
      content:
        `$ ${alvo}\n(código ${r.code ?? '?'})\n\n${r.stdout}` +
        (r.stderr === '' ? '' : `\n--- stderr ---\n${r.stderr}`),
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
    // `{ atual, nova }` — os nomes que a rota espera. Eu tinha escrito
    // `{ current, next }` de cabeça, e a troca falhava calada.
    const r = await deps.pedir('POST', '/api/connections/vault/password', {
      atual, nova,
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
    const r = await deps.pedir<unknown>('POST', '/api/connections/export-all');
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
    // A rota espera `{ conexoes, politica }` — mandar o arquivo cru, como eu
    // fazia, importava ZERO conexões e não dizia por quê.
    const lista = Array.isArray(conteudo)
      ? conteudo
      : ((conteudo as { conexoes?: unknown }).conexoes ?? []);
    if (!Array.isArray(lista) || lista.length === 0) {
      void vscode.window.showErrorMessage('Braytech Code: o arquivo não tem conexões.');
      return;
    }
    const politica = await vscode.window.showQuickPick(
      ['pular', 'substituir', 'duplicar'],
      { placeHolder: 'O que fazer com as conexões que já existem?' }
    );
    if (politica === undefined) return;
    const r = await deps.pedir<{ criadas: number; substituidas: number; puladas: number }>(
      'POST', '/api/connections/import', { conexoes: lista, politica }
    );
    if (r === null) return;
    deps.recarregarTudo();
    void vscode.window.showInformationMessage(
      `Braytech Code: ${r.criadas} criada(s), ${r.substituidas} substituída(s), ` +
        `${r.puladas} pulada(s).`
    );
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
      conexaoId: item.conexao,
      rotulo: String(item.label ?? ''),
      somenteLeitura: item.trancada,
    });
  });

  registrar('braytech.abrirTerminalDaConexao', (item) =>
    deps.abrirTerminal(item.conexao, String(item.label ?? ''))
  );

  // ---- do NÓ (hover) ----
  registrar('braytech.abrirQueryNoDatabase', (item) => {
    deps.definirConexaoAtiva(item.conexao);
    void deps.abrirQuery(item.conexao, item.banco ?? '', 'Nova consulta', '');
  });

  // `PedidoDeCriacao`: `{ id, caminho, rotulo, nomeBase, esqueleto, database,
  // somenteLeitura }`. O ESQUELETO é o `meta.template` do driver — sem ele o
  // diálogo abria em branco.
  registrar('braytech.criarObjeto', (item) => {
    const rotulo = String(item.label ?? '');
    deps.abrirDialogo('criacao', {
      id: item.conexao,
      caminho: item.nodePath,
      rotulo,
      nomeBase: `novo_${rotulo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      esqueleto: texto(item.meta.template),
      database: item.banco,
      // Com `false` fixo o diálogo oferecia EXECUTAR numa conexão de leitura.
      // É o mesmo defeito que a spec 096 registrou no `abrirChave`, e que eu
      // reintroduzi em quatro lugares de uma vez.
      somenteLeitura: item.trancada,
    });
  });

  // O diálogo espera `{ id, caminho, rotulo, criterios, atual }` — eu mandava
  // `{ connectionId, nodePath }`, que ele não lê. Abria vazio, e clicar não
  // fazia nada. Os nomes vêm do `PedidoDeFiltro`, conferidos no fonte.
  registrar('braytech.filtrarCategoria', async (item) => {
    const guardados = await deps.pedir<Record<string, unknown>>(
      'GET',
      `/api/connections/${encodeURIComponent(item.conexao)}/tree-filters`
    );
    const chave = item.nodePath.join('\u0000');
    const criterios = Array.isArray(item.meta.criterios) ? item.meta.criterios : ['nome'];
    deps.abrirDialogo('filtro', {
      id: item.conexao,
      caminho: item.nodePath,
      rotulo: String(item.label ?? ''),
      criterios,
      atual: guardados?.[chave] ?? null,
    });
  });

  // ---- do arquivo de QUERY (hover) ----
  registrar('braytech.renomearQuery', async (item) => {
    const caminho = texto(item.meta.arquivo);
    if (caminho === '') return;
    const nome = await vscode.window.showInputBox({
      prompt: 'Novo nome', value: path.basename(caminho), ignoreFocusOut: true,
    });
    if (nome === undefined || nome.trim() === '') return;
    // `{ connectionId, database, de, para }` — a rota trabalha por VÍNCULO e
    // NOME, não por caminho em disco.
    const r = await deps.pedir('POST', '/api/queries/rename', {
      connectionId: item.conexao,
      database: item.banco ?? '',
      de: path.basename(caminho),
      para: nome.trim(),
    });
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
    const r = await deps.pedir('DELETE', '/api/queries', {
      connectionId: item.conexao,
      database: item.banco ?? '',
      nome: path.basename(caminho),
    });
    if (r === null) return;
    deps.recarregarTudo();
  });

  // **O CLIQUE no arquivo de query.**
  //
  // Existia um segundo caminho, registrado no `extension.ts`, que abria tudo
  // como TEXTO — e era esse que o clique usava. Eu tinha consertado só o da
  // criação e dito que estava resolvido; o `.sqlbook` continuou virando JSON na
  // tela dele. Agora é UM caminho só, e não há como divergirem.
  registrar('braytech.abrirArquivoDeQuery', async (item) => {
    const caminho = texto(item.meta.arquivo);
    if (caminho === '') return;
    deps.definirConexaoAtiva(item.conexao);
    await abrirArquivoDeQuery(deps, caminho, item.conexao, item.banco ?? '');
  });

  // **O clique num nó comum abre uma CONSULTA**, com o schema no alvo — é o
  // `onAbrirQuery` do painel, copiado campo a campo. A GRADE continua existindo,
  // mas no ícone da linha, e só em tabela e view.
  registrar('braytech.abrirQueryDoNo', async (item) => {
    const objeto = texto(item.meta.object) || String(item.label ?? '');
    const schema = texto(item.meta.schema);
    const alvoSql = schema === '' ? objeto : `${schema}.${objeto}`;
    deps.definirConexaoAtiva(item.conexao);
    await deps.abrirQuery(
      item.conexao,
      item.banco,
      `${objeto}.sql`,
      `SELECT * FROM ${alvoSql} LIMIT 100;`
    );
  });

  registrar('braytech.abrirChave', (item) => {
    deps.definirConexaoAtiva(item.conexao);
    deps.abrirAbaDaIde('chave', texto(item.meta.chave), {
      conexaoId: item.conexao,
      chave: texto(item.meta.chave),
      somenteLeitura: item.trancada,
    });
  });

  // ---- do arquivo REMOTO (hover) ----
  registrar('braytech.favoritarRemoto', async (item) => {
    const alvo = remotoDe(item);
    if (alvo === null) return;
    const r = await deps.pedir<readonly string[]>(
      'POST', rota(item, '/files/favorites'), { path: alvo }
    );
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
  // **A rota devolve o DIAGRAMA, não o markdown.** Eu lia `r.markdown`, que não
  // existe, e o diagrama abria vazio — foi o "só funciona na outra versão".
  // Quem transforma um no outro é `documentoDoDiagrama`, o MESMO que a IDE usa.
  const r = await deps.pedir<DiagramaER>(
    'GET',
    `/api/connections/${encodeURIComponent(item.conexao)}/er?${busca.toString()}`
  );
  if (r === null) return;
  deps.abrirDiagrama(
    `Diagrama ER — ${daTabela ? `${rotulo} e vizinhos` : rotulo}`,
    documentoDoDiagrama(r)
  );
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
  // Arquivo vai por `POST /files` com `content`; pasta por `POST /files/mkdir`.
  // Sem o `content`, criar arquivo respondia erro de corpo inválido.
  const r = await deps.pedir(
    'POST',
    `/api/connections/${encodeURIComponent(item.conexao)}/files${tipo === 'pasta' ? '/mkdir' : ''}`,
    tipo === 'pasta' ? { path: destino } : { path: destino, content: '' }
  );
  if (r === null) return;
  deps.recarregarTudo();
}
