// A árvore de conexões, NATIVA, na barra lateral do editor.
//
// São DUAS: `Databases` e `Services`. Quem decide em qual cada conexão entra é
// o DRIVER (`panel`), e não uma lista escrita aqui — ver `paineis.ts`.
//
// **Por que nativa, e não a webview da IDE.** Ele foi direto: *"A extensão não
// é pra ser 'fiel' à IDE, ela só precisa ter as mesmas 'funcionalidades'"*, e
// pediu que *"os ícones seguissem os ícones do tema setado no cursor ou
// vscode"*. Dentro de uma webview isso é impossível: um SVG nosso não sabe qual
// tema ele escolheu. Com `TreeItem` vem de graça — e junto vêm o teclado, a
// busca da lateral, o menu de contexto do editor e, o que originou tudo, a
// SOLTURA DE ARQUIVO, que webview não recebe (microsoft/vscode#111092).
//
// O `TreeNode` do motor e o `TreeItem` do editor dizem quase a mesma coisa
// campo a campo — o motor não muda uma linha por causa deste arquivo.
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Motor } from './motor';
import { codiconDe, nomeLogico, svgDaMarca } from './icones-do-editor';
import { comandoDaAcao as comandoDaAcaoDoNo } from './acoesDoMenu';
import { padraoDeFiltro } from './filtro';
import { arquivosSoltos } from './soltura';
import {
  estaVazio, interpretarData, interpretarTamanho, type FiltroDaArvore,
} from './filtro-da-arvore';
import {
  filtrarPorPainel, painelPorTipo,
  type ConexaoPublica, type DriverPublico, type Grupo, type Painel,
} from './paineis';

/** Uma ação de menu declarada pelo driver para um nó. */
export interface AcaoDoNo {
  readonly id: string;
  readonly label: string;
  readonly danger?: boolean;
  readonly copiar?: boolean;
}

/** O que o motor devolve em `GET /api/connections/:id/children`. */
interface NoDoMotor {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly detail?: string;
  readonly hasChildren: boolean;
  readonly actions?: readonly AcaoDoNo[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface RaizDoMotor {
  readonly vault: { readonly exists: boolean; readonly unlocked: boolean };
  readonly tree: Grupo;
  /** Quais conexões estão de pé — o motor já responde, e o menu usa. */
  readonly openIds?: readonly string[];
}

type Especie = 'grupo' | 'conexao' | 'no' | 'aviso' | 'query' | 'arquivo';

/**
 * O esquema das URIs de arquivo REMOTO.
 *
 * Existe para o tema de ícones dele casar pela extensão do nome — é assim que
 * `ThemeIcon.File` funciona. Um esquema próprio, e não `file:`, porque um
 * caminho remoto que por acaso exista aqui na máquina ganharia as cores do git
 * local e o menu de arquivo do editor: informação errada, com cara de certa.
 */
export const ESQUEMA_REMOTO = 'braytech-remoto';

/** Onde ficam os SVGs de marca do pacote. */
let raizDosRecursos: vscode.Uri | null = null;
export function definirRecursos(uri: vscode.Uri): void {
  raizDosRecursos = uri;
}

function svgDeMarca(marca: string): { light: vscode.Uri; dark: vscode.Uri } | null {
  return svgDosRecursos(`devicon-${marca}`);
}

/** O par claro/escuro de um SVG de `recursos/icones`, se ele existir. */
function svgDosRecursos(base: string): { light: vscode.Uri; dark: vscode.Uri } | null {
  if (raizDosRecursos === null) return null;
  const arquivo = (tema: 'light' | 'dark'): vscode.Uri =>
    vscode.Uri.joinPath(raizDosRecursos as vscode.Uri, 'icones', `${base}-${tema}.svg`);
  const claro = arquivo('light');
  if (!fs.existsSync(claro.fsPath)) return null;
  return { light: claro, dark: arquivo('dark') };
}

export class ItemDaArvore extends vscode.TreeItem {
  constructor(
    readonly especie: Especie,
    /** Vazio nos grupos: um grupo não pertence a conexão nenhuma. */
    readonly conexao: string,
    /**
     * O caminho do nó DENTRO da conexão.
     *
     * Guardado inteiro, e não só o último id: é assim que o motor identifica um
     * nó (`children(['banco', 'tabela'])`), e reconstruí-lo subindo pelos pais
     * daria a mesma resposta por um caminho mais frágil.
     */
    readonly nodePath: readonly string[],
    /** Só nos grupos: o caminho do grupo, para achar os filhos dele. */
    readonly grupo: string,
    rotulo: string,
    detalhe: string | undefined,
    temFilhos: boolean,
    icone: string,
    /** O que o driver declara que se pode fazer com este nó. */
    readonly acoes: readonly AcaoDoNo[] = [],
    /** O `meta` que o driver mandou — é dele que sai `remotePath` e `object`. */
    readonly meta: Readonly<Record<string, unknown>> = {},
    /**
     * A conexão é somente-leitura?
     *
     * Vira `.trancada` no `contextValue`, e é o que ESCONDE criar, renomear,
     * apagar e executar — a mesma regra do painel (`useAcoesRemotas`). A trava
     * de valer está na rota; isto evita oferecer o que vai ser recusado.
     */
    readonly trancada = false,
    /**
     * O banco a que este nó pertence, herdado do pai.
     *
     * **O nó fundo não repete o `meta.database` do database.** Uma procedure do
     * PostgreSQL traz `{ schema, object, category }` e mais nada — ler o banco
     * só do próprio nó dava vazio, e a rota que abre a query recusa: *"Campo
     * obrigatório ausente ou inválido: database"*, que foi o que ele viu ao
     * clicar numa procedure em 08/09/2026.
     *
     * O painel da IDE já fazia assim: `bancoAqui` desce na recursão. Aqui desce
     * pelo pai, que é o mesmo caminho.
     */
    readonly bancoHerdado: string | null = null
  ) {
    super(
      rotulo,
      temFilhos
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    // O detalhe cinza do motor ("92", "8.0.40", "64.1G") é exatamente o que o
    // editor chama de `description`.
    if (detalhe !== undefined) this.description = detalhe;
    if (typeof meta.tooltip === 'string') this.tooltip = meta.tooltip;

    const remoto = caminhoRemotoDe(meta);
    if (remoto !== null) {
      // **O pedido dele, literal.** Com `resourceUri` posto, o editor manda o
      // TEMA DE ÍCONES desenhar — Material Icon Theme, Seti, o que ele estiver
      // usando —, e um `.sh` remoto ganha o mesmo ícone que um `.sh` daqui.
      this.resourceUri = vscode.Uri.from({ scheme: ESQUEMA_REMOTO, path: remoto.caminho });
      this.iconPath = remoto.ehPasta ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    } else {
      const marca = svgDaMarca(icone);
      // **O desenho DELE ganha de tudo** (`icones/<nome>.svg` na raiz do
      // repositório). Depois a marca, colorida de propósito: é por ela que ele
      // acha uma conexão de relance. Sobrando, o `ThemeIcon`, que muda de cor
      // com o tema do editor sozinho.
      const proprio = svgDosRecursos(`proprio-${nomeLogico(icone)}`);
      const svg = proprio ?? (marca === null ? null : svgDeMarca(marca));
      this.iconPath = svg ?? new vscode.ThemeIcon(codiconDe(icone));
    }

    this.contextValue = contextoDe(especie, acoes, remoto, meta, trancada);
  }

  /**
   * O banco deste nó: o dele se tiver, senão o do pai.
   *
   * Todo comando lê DAQUI, e não de `meta.database`: fora do nó de database
   * o `meta` não tem esse campo, e o que chegava à rota era vazio.
   */
  get banco(): string | null {
    return typeof this.meta.database === 'string' ? this.meta.database : this.bancoHerdado;
  }

  /** A pasta remota que este nó representa, ou `null`. */
  get pastaRemota(): string | null {
    const remoto = caminhoRemotoDe(this.meta);
    return remoto !== null && remoto.ehPasta ? remoto.caminho : null;
  }
}

interface Remoto {
  readonly caminho: string;
  readonly ehPasta: boolean;
}

function caminhoRemotoDe(meta: Readonly<Record<string, unknown>>): Remoto | null {
  const caminho = meta.remotePath;
  if (typeof caminho !== 'string' || caminho === '') return null;
  // `link` conta como pasta: ele abre, e se não for, vem vazio — a mesma
  // decisão que o driver já toma no `hasChildren`.
  return { caminho, ehPasta: meta.kind !== 'file' };
}

/**
 * O `when` dos menus do `package.json` lê isto.
 *
 * Um sufixo por capacidade, e não um nome por espécie: um item de menu que
 * aparece onde não há ação é pior que um menu curto, porque ele promete.
 */
function contextoDe(
  especie: Especie,
  acoes: readonly AcaoDoNo[],
  remoto: Remoto | null,
  meta: Readonly<Record<string, unknown>> = {},
  trancada = false
): string {
  // As CAPACIDADES do nó, como o driver as declara. São elas que decidem quais
  // itens de menu aparecem — do mesmo jeito que decidem na IDE, onde o menu é
  // montado com `...(no.meta?.queries === true ? [...] : [])`.
  // **As capacidades valem por ESPÉCIE, e não pelo `meta` inteiro.**
  //
  // O erro: os itens que a interface cria — a pasta `Query` e os arquivos dela
  // — carregam `database` no `meta` para guardar o VÍNCULO. Derivar a
  // capacidade `.database` disso fazia um `.sqlbook` ganhar o botão de
  // `Abrir Query`, que nenhum arquivo tem no painel. Ele viu na tela.
  //
  // No painel essas condições são lidas de um NÓ DO DRIVER. Aqui é igual: só
  // `especie === 'no'` as consulta.
  const doDriver =
    especie !== 'no'
      ? []
      : [
          ...(meta.diagramaEr === true ? ['er'] : []),
          ...(meta.diagramaDaTabela === true ? ['erTabela'] : []),
          ...(meta.category === 'tables' || meta.category === 'views' ? ['tabela'] : []),
          ...(typeof meta.database === 'string' ? ['database'] : []),
          ...(meta.categoria === true ? ['categoria'] : []),
          // O `+` de CHAVE, declarado pelo driver de chave-valor.
          ...(meta.novaChave === true ? ['novaChave'] : []),
          ...(typeof meta.template === 'string' ? ['template'] : []),
        ];
  const capacidades = [
    ...(remoto === null ? [] : [remoto.ehPasta ? 'pastaRemota' : 'arquivoRemoto']),
    ...(meta.executable === true ? ['executavel'] : []),
    ...doDriver,
    // Estes dois são NOSSOS, e por isso vêm da espécie e não do `meta`.
    ...(especie === 'query' ? ['queries'] : []),
    ...(especie === 'arquivo' ? ['arquivoDeQuery'] : []),
    ...(trancada ? ['trancada'] : []),
  ];
  const base = [`braytech.${especie}`, ...capacidades].join('.');
  // Cada ação vira `[id]`, e o `when` de cada item de menu casa com o dela.
  //
  // Por que assim, e não um item "Ações…" que abre uma lista: em 04/09 ele
  // derrubou a árvore nativa justamente porque *"o menu de contexto virava
  // lista de opções"*. Menu nativo não aceita rótulo dinâmico, então o preço é
  // declarar os itens no `package.json` — e o `conferir:extensao` falha quando
  // um driver declarar uma ação que não tem item, em vez de ela sumir calada.
  return base + acoes.map((a) => `[${a.id}]`).join('');
}

export class ArvoreDeConexoes
  implements vscode.TreeDataProvider<ItemDaArvore>, vscode.TreeDragAndDropController<ItemDaArvore>
{
  private readonly mudou = new vscode.EventEmitter<ItemDaArvore | undefined>();
  readonly onDidChangeTreeData = this.mudou.event;

  /**
   * **O que abre a porta que a webview não tinha.**
   *
   * `files` é o tipo que o editor usa para arquivo vindo do SISTEMA. É a API
   * oficial de soltura em árvore — a mesma que a extensão de referência usa, e
   * a que não existe para webview.
   */
  //
  // **`text/uri-list` também, e é o que faltava.** O editor só ENTREGA a
  // soltura se o tipo estiver declarado aqui: arrastar do Explorer dele, ou do
  // gerenciador de arquivos do sistema, chega como `uri-list` — e a árvore,
  // declarando só `files`, recusava antes de qualquer código meu rodar. Era
  // por isso que o arraste falhava CALADO.
  readonly dropMimeTypes = ['files', 'text/uri-list'];
  /** Arrastar de dentro da árvore ainda não faz nada — declarado vazio. */
  readonly dragMimeTypes: string[] = [];

  /**
   * A resposta da raiz, guardada entre as chamadas de um mesmo desenho.
   *
   * `getChildren` é chamado uma vez por nó expandido, e sem isto cada um deles
   * refaria `GET /api/connections` — a árvore inteira do cofre, para descobrir
   * um grupo. `recarregar()` a joga fora.
   */
  private raiz: Promise<RaizDoMotor> | null = null;
  private drivers: Promise<readonly DriverPublico[]> | null = null;

  constructor(
    private readonly motor: Motor,
    private readonly painel: Painel
  ) {}

  recarregar(): void {
    this.raiz = null;
    this.comFiltrosLidos.clear();
    this.descricoes.clear();
    this.somenteLeitura.clear();
    this.mudou.fire(undefined);
  }

  getTreeItem(item: ItemDaArvore): vscode.TreeItem {
    return item;
  }

  async getChildren(pai?: ItemDaArvore): Promise<ItemDaArvore[]> {
    // **Erro aqui não pode sumir.** O editor engole a rejeição de um
    // `getChildren` e desenha um nó vazio: clica, nada acontece, e não há uma
    // palavra na tela dizendo por quê.
    try {
      return await this.filhos(pai);
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : String(erro);
      void vscode.window.showErrorMessage(`Braytech Code: ${texto}`);
      return [avisoDe(texto, 'trigger')];
    }
  }

  /**
   * Sobe o que foi solto na pasta do nó.
   *
   * **Pergunta antes.** É escrita no servidor DELE, e um arraste sem querer não
   * pode virar upload — a mesma regra que a IDE já aplica à pasta arrastada de
   * dentro.
   */
  async handleDrop(
    alvo: ItemDaArvore | undefined,
    dados: vscode.DataTransfer,
    _ficha: vscode.CancellationToken
  ): Promise<void> {
    const pasta = alvo?.pastaRemota ?? null;
    if (alvo === undefined || pasta === null) {
      void vscode.window.showWarningMessage(
        'Solte sobre uma PASTA do servidor — foi ali que o arquivo vai parar.'
      );
      return;
    }

    const arquivos = await arquivosSoltos(dados);
    if (arquivos.length === 0) {
      // **Diz o que chegou.** Um aviso genérico manda procurar às cegas; com
      // os tipos à vista dá para saber se o editor entregou outra coisa.
      const tipos: string[] = [];
      try {
        dados.forEach((_v, mime) => tipos.push(mime));
      } catch {
        // Sem a lista, o aviso sai genérico — e sai.
      }
      void vscode.window.showWarningMessage(
        tipos.length === 0
          ? 'O que foi solto não trouxe arquivo nenhum.'
          : `O que foi solto não trouxe arquivo: veio ${tipos.join(', ')}.`
      );
      return;
    }

    const quantos = arquivos.length === 1
      ? `"${arquivos[0]?.nome ?? ''}"`
      : `${arquivos.length} arquivos`;
    const ok = await vscode.window.showWarningMessage(
      `Subir ${quantos} para ${pasta}?`,
      { modal: true, detail: 'Escreve no servidor.' },
      'Subir'
    );
    if (ok !== 'Subir') return;

    await this.subir(alvo, pasta, arquivos);
    this.mudou.fire(alvo);
  }

  /**
   * Sobe pelo SELETOR do sistema — o mesmo destino, sem depender de gesto.
   *
   * Existe porque o arraste nem sempre chega: quando ele falha, falha calado, e
   * um item de menu é o caminho que nunca some.
   */
  async enviarEscolhidos(alvo: ItemDaArvore): Promise<void> {
    const pasta = alvo.pastaRemota;
    if (pasta === null) return;
    const escolhidos = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: `Enviar para ${pasta}`,
    });
    if (escolhidos === undefined || escolhidos.length === 0) return;
    const arquivos = await Promise.all(
      escolhidos.map(async (uri) => ({
        nome: path.basename(uri.fsPath),
        bytes: await vscode.workspace.fs.readFile(uri),
      }))
    );
    await this.subir(alvo, pasta, arquivos);
  }

  private async subir(
    alvo: ItemDaArvore,
    pasta: string,
    arquivos: readonly { nome: string; bytes: Uint8Array }[]
  ): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Subindo para ${pasta}` },
      async (progresso) => {
        let feitos = 0;
        for (const arquivo of arquivos) {
          progresso.report({ message: `${feitos + 1} de ${arquivos.length}` });
          // `arquivo.nome` pode trazer barra (pasta solta): o caminho
          // relativo recria a estrutura do outro lado, e o `mkdir=1` abaixo
          // cria o que faltar.
          const destino = `${pasta === '/' ? '' : pasta}/${arquivo.nome}`;
          // Um de cada vez: SFTP e FTP têm um canal só, e cem gravações
          // simultâneas viram cem canais que o servidor recusa.
          await this.motor.pedirBytes(
            'POST',
            `/api/connections/${encodeURIComponent(alvo.conexao)}` +
              `/files/upload?path=${encodeURIComponent(destino)}&mkdir=1`,
            arquivo.bytes
          );
          feitos += 1;
        }
      }
    );
  }

  private async filhos(pai?: ItemDaArvore): Promise<ItemDaArvore[]> {
    if (pai?.especie === 'aviso') return [];

    if (pai === undefined) return this.daRaiz();

    if (pai.especie === 'grupo') {
      const filtrada = await this.arvoreDoPainel();
      const grupo = filtrada === null ? null : acharGrupo(filtrada, pai.grupo);
      return grupo === null ? [] : this.doGrupo(grupo);
    }

    // Daqui para baixo quem responde é o driver, e a extensão só desenha.
    await this.lerFiltros(pai.conexao);
    const busca = new URLSearchParams();
    for (const p of pai.nodePath) busca.append('path', p);
    const nos = await this.motor.pedir<NoDoMotor[]>(
      'GET',
      `/api/connections/${encodeURIComponent(pai.conexao)}/children?${busca.toString()}` +
        this.parametrosDoFiltro(pai.conexao, pai.nodePath)
    );

    if (pai.especie === 'query') return this.arquivosDeQuery(pai);

    const itens = nos.map((n) => {
      const item = new ItemDaArvore(
        'no', pai.conexao, [...pai.nodePath, n.id], '',
        n.label, n.detail, n.hasChildren, n.icon, n.actions ?? [], n.meta ?? {},
        this.somenteLeitura.has(pai.conexao),
        pai.banco
      );
      // **A CASCATA DO CLIQUE, na ordem exata do painel.**
      //
      // Eu tinha resumido tudo a "tem `meta.object`, abre a grade" — e uma
      // PROCEDURE tem `meta.object`. Clicar numa dava erro, porque grade de
      // procedure não existe. A grade é o ÍCONE da linha, e só em tabela e
      // view; o clique é outra coisa, e o nó tem opinião sobre ela.
      const meta = n.meta ?? {};
      if (meta.atalho !== undefined) {
        // `Users` e `Favorites` são atalhos NOSSOS: só expandem.
      } else if (typeof meta.remotePath === 'string' && meta.kind === 'file') {
        item.command = { command: 'braytech.abrirArquivoRemoto', title: 'Abrir', arguments: [item] };
      } else if (typeof meta.chave === 'string') {
        // Uma CHAVE não abre uma query (spec 089): num banco chave-valor
        // `SELECT * FROM` não é consulta ruim, é impossível.
        item.command = { command: 'braytech.abrirChave', title: 'Abrir chave', arguments: [item] };
      } else if (typeof meta.acaoAoClicar === 'string') {
        // O NÓ diz o que o clique faz, quando tem opinião — é como o índice do
        // Redis abre a busca em vez de um SELECT.
        item.command = {
          command: comandoDaAcaoDoNo(meta.acaoAoClicar),
          title: 'Abrir',
          arguments: [item],
        };
      } else if (meta.category === 'tables' || meta.category === 'views') {
        // A GRADE. Tabela e view também expandem para as colunas, e o editor
        // faz as duas coisas no mesmo clique — tirar o comando por causa do
        // `hasChildren` foi o que apagou a grade dele.
        item.command = { command: 'braytech.abrirNo', title: 'Abrir dados', arguments: [item] };
      } else if (n.hasChildren) {
        // Database, esquema, categoria: o clique só abre.
      } else {
        item.command = { command: 'braytech.abrirQueryDoNo', title: 'Abrir consulta', arguments: [item] };
      }
      return item;
    });

    // **A categoria `Query` é NOSSA, não do driver.** Os arquivos são da IDE, e
    // pedir a cada driver que liste arquivos que ele não conhece inverteria o
    // Artigo III. O driver declara que o nó é um database (`meta.database`); a
    // interface decide que isso merece uma pasta de queries — a mesma regra da
    // IDE (spec 038). Sem ela os `.sqlbook` dele ficam inalcançáveis, e foi o
    // que aconteceu quando eu a perdi na reescrita.
    const database = typeof pai.meta.database === 'string' ? pai.meta.database : null;
    if (database === null) return itens;
    const pasta = new ItemDaArvore(
      'query', pai.conexao, pai.nodePath, '', 'Query', undefined, true, 'folder', [],
      { database, queries: true }, this.somenteLeitura.has(pai.conexao)
    );
    return [pasta, ...itens];
  }

  /** Os `.sql` e `.sqlbook` de um database (spec 038). */
  private async arquivosDeQuery(pai: ItemDaArvore): Promise<ItemDaArvore[]> {
    const database = typeof pai.meta.database === 'string' ? pai.meta.database : '';
    const arquivos = await this.motor.pedir<
      readonly { nome: string; caminho: string; bytes: number }[]
    >(
      'GET',
      `/api/queries?connectionId=${encodeURIComponent(pai.conexao)}` +
        `&database=${encodeURIComponent(database)}`
    );
    if (arquivos.length === 0) return [avisoDe('Nenhuma query ainda.', 'query')];
    return arquivos.map((a) => {
      const item = new ItemDaArvore(
        'arquivo', pai.conexao, [], '', a.nome, tamanhoCurto(a.bytes), false,
        a.nome.endsWith('.sqlbook') ? 'query' : 'file', [],
        { database, arquivo: a.caminho }, this.somenteLeitura.has(pai.conexao)
      );
      item.command = {
        command: 'braytech.abrirArquivoDeQuery',
        title: 'Abrir',
        arguments: [item],
      };
      return item;
    });
  }

  private async daRaiz(): Promise<ItemDaArvore[]> {
    const raiz = await this.lerRaiz();
    if (!raiz.vault.exists) {
      return [avisoDe('Nenhum cofre ainda — crie uma conexão.', 'key')];
    }
    // Cofre trancado não é erro: é o primeiro passo. Uma linha que se clica
    // vale mais que uma árvore vazia sem motivo aparente.
    if (!raiz.vault.unlocked) return [this.cofreTrancado()];

    const filtrada = await this.arvoreDoPainel();
    if (filtrada === null) return [];
    const itens = this.doGrupo(filtrada);
    if (itens.length > 0) return itens;
    const que = this.painel === 'database' ? 'banco' : 'serviço';
    return [avisoDe(`Nenhuma conexão de ${que}.`, 'folder')];
  }

  private async arvoreDoPainel(): Promise<Grupo | null> {
    const raiz = await this.lerRaiz();
    const porTipo = painelPorTipo(await this.lerDrivers());
    await this.lerDescricoes();
    return filtrarPorPainel(raiz.tree, this.painel, porTipo);
  }

  /** Pastas antes de folhas — a mesma ordem da árvore de arquivos. */
  private doGrupo(grupo: Grupo): ItemDaArvore[] {
    const pastas = grupo.groups.map(
      (g) => new ItemDaArvore('grupo', '', [], g.path, g.name, undefined, true, 'folder')
    );
    // **Sem `command` na conexão, de propósito.** Um `TreeItem` com comando
    // executa o comando no clique em vez de expandir, e era isso que fazia a
    // árvore não abrir.
    const conexoes = grupo.connections.map((c: ConexaoPublica) => {
      // **O detalhe é a DISTRO do servidor mais o `RO`, não o tipo.**
      //
      // É o que o painel mostra (spec 052), e o comentário dele explica por que
      // os dois juntos: *"são duas informações, e esconder uma pela outra seria
      // perder justamente a que avisa que a conexão não escreve"*. Eu mostrava
      // `mysql`, que já está no ícone.
      const detalhe =
        [this.descricoes.get(c.id) ?? null, c.readOnly === true ? 'RO' : null]
          .filter((p) => p !== null)
          .join(' · ') || undefined;
      const item = new ItemDaArvore(
        'conexao', c.id, [], grupo.path, c.label, detalhe, true, this.iconeDoTipo(c.type),
        [],
        // O `meta` da conexão carrega o que os comandos precisam: editar pede
        // grupo e rótulo, e `Conectar`/`Desconectar` são itens diferentes.
        { grupo: grupo.path, rotulo: c.label, tipo: c.type, aberta: this.abertas.has(c.id) },
        c.readOnly === true
      );
      if (c.readOnly === true) this.somenteLeitura.add(c.id);
      const pode = this.capacidadesPorTipo.get(c.type);
      item.contextValue =
        `braytech.conexao.${this.abertas.has(c.id) ? 'aberta' : 'fechada'}` +
        (pode?.arquivos === true ? '.comArquivos' : '') +
        (pode?.terminal === true ? '.comTerminal' : '');
      return item;
    });
    return [...pastas, ...conexoes];
  }

  /**
   * O ícone da conexão vem do DRIVER, não de uma lista daqui.
   *
   * Enquanto o catálogo não chegou, `database` — trocar depois é um redesenho,
   * e um quadrado vazio no lugar seria pior.
   */
  private iconeDoTipo(tipo: string): string {
    return this.catalogo.get(tipo) ?? 'database';
  }

  private catalogo = new Map<string, string>();

  /**
   * O que cada driver SABE fazer, por tipo.
   *
   * É o mesmo `kind`/`hasTerminal` que o painel da IDE consulta para decidir se
   * desenha `Abrir numa aba` e `Abrir no terminal`. Sem isto os dois apareciam
   * em conexão de BANCO, onde a aba não teria nada dentro — foi o que ele viu.
   */
  private capacidadesPorTipo = new Map<string, { arquivos: boolean; terminal: boolean }>();

  /**
   * As conexões abertas, para o menu dizer `Desconectar` em vez de `Conectar`.
   *
   * Vem do mesmo `GET /api/connections` que desenha a árvore — o motor já
   * responde quais estão de pé, e perguntar de novo por conexão custaria uma
   * ida por linha.
   */
  private abertas = new Set<string>();

  /**
   * Os filtros guardados, por `conexão\u0000caminho`.
   *
   * **Quem filtra é o SERVIDOR.** O filtro não é um `Array.filter` daqui: ele
   * viaja como `filter`/`owner`/`minBytes`/`since` no `children`, porque uma
   * categoria com 95 tabelas não deve trazer as 95 para a interface descartar
   * 90. Era isso que faltava — eu abria o diálogo e nunca mandava nada.
   */
  private filtros = new Map<string, FiltroDaArvore>();

  /** Carrega os filtros de uma conexão do disco, uma vez por desenho. */
  private async lerFiltros(conexaoId: string): Promise<void> {
    if (this.comFiltrosLidos.has(conexaoId)) return;
    this.comFiltrosLidos.add(conexaoId);
    const guardados = await this.motor.pedir<Record<string, FiltroDaArvore>>(
      'GET',
      `/api/connections/${encodeURIComponent(conexaoId)}/tree-filters`
    );
    for (const [caminho, filtro] of Object.entries(guardados)) {
      this.filtros.set([conexaoId, caminho].join('\u0000'), filtro);
    }
  }

  private comFiltrosLidos = new Set<string>();

  /** A linha do servidor por conexão — `GET /:id/describe`, como no painel. */
  private descricoes = new Map<string, string>();

  /** Conexões marcadas somente-leitura, por id. */
  private somenteLeitura = new Set<string>();

  /**
   * Busca a descrição das conexões ABERTAS, uma vez por desenho.
   *
   * Só das abertas de propósito: `describe` fala com o servidor, e pedi-lo para
   * uma conexão fechada a abriria — dez conexões viram dez sessões que ninguém
   * pediu.
   */
  private async lerDescricoes(): Promise<void> {
    const faltando = [...this.abertas].filter((id) => !this.descricoes.has(id));
    await Promise.all(
      faltando.map(async (id) => {
        try {
          const d = await this.motor.pedir<string | null>(
            'GET',
            `/api/connections/${encodeURIComponent(id)}/describe`
          );
          if (typeof d === 'string' && d !== '') this.descricoes.set(id, d);
        } catch {
          // Descrição é enfeite informativo: falhar aqui não pode derrubar a
          // árvore inteira.
        }
      })
    );
  }

  /**
   * Os parâmetros do filtro deste nó, prontos para a URL.
   *
   * Os NOMES são os que o `Api.children` usa — `filter`, `owner`, `minBytes`,
   * `since`. Inventar outros aqui daria uma busca que o servidor ignora, que é
   * indistinguível de não filtrar.
   */
  private parametrosDoFiltro(conexaoId: string, nodePath: readonly string[]): string {
    const filtro = this.filtros.get([conexaoId, nodePath.join('\u0000')].join('\u0000'));
    if (filtro === undefined || estaVazio(filtro)) return '';
    const partes = Object.entries({
      filter: padraoDeFiltro(filtro.nome),
      owner: filtro.dono === '' ? null : filtro.dono,
      minBytes: filtro.tamanho === '' ? null : interpretarTamanho(filtro.tamanho),
      since: filtro.desde === '' ? null : interpretarData(filtro.desde, new Date()),
    })
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`);
    return partes.join('');
  }

  /** Guarda o filtro escolhido e redesenha o ramo. */
  async aplicarFiltro(
    conexaoId: string,
    nodePath: readonly string[],
    filtro: FiltroDaArvore
  ): Promise<void> {
    await this.motor.pedir(
      'PUT',
      `/api/connections/${encodeURIComponent(conexaoId)}/tree-filters`,
      { path: nodePath, filtro }
    );
    this.filtros.set([conexaoId, nodePath.join('\u0000')].join('\u0000'), filtro);
    this.mudou.fire(undefined);
  }

  private cofreTrancado(): ItemDaArvore {
    const item = avisoDe('Cofre trancado — clique para destrancar', 'key');
    item.command = { command: 'braytech.destrancarCofre', title: 'Destrancar o cofre' };
    return item;
  }

  private lerRaiz(): Promise<RaizDoMotor> {
    this.raiz ??= this.motor
      .pedir<RaizDoMotor>('GET', '/api/connections')
      .then((r) => {
        this.abertas = new Set(r.openIds ?? []);
        return r;
      });
    return this.raiz;
  }

  private lerDrivers(): Promise<readonly DriverPublico[]> {
    // O catálogo de drivers não muda enquanto o motor vive: uma vez basta.
    this.drivers ??= this.motor
      .pedir<
        readonly (DriverPublico & {
          readonly icon?: string;
          readonly kind?: string;
          readonly hasTerminal?: boolean;
        })[]
      >(
        'GET',
        '/api/connections/drivers'
      )
      .then((lista) => {
        this.catalogo = new Map(
          lista.flatMap((d) => (d.icon === undefined ? [] : [[d.type, d.icon] as const]))
        );
        this.capacidadesPorTipo = new Map(
          lista.map((d) => [
            d.type,
            { arquivos: d.kind === 'files', terminal: d.hasTerminal === true },
          ])
        );
        return lista;
      });
    return this.drivers;
  }
}

/** "12.0K", "3.4M" — o mesmo formato do detalhe da árvore. */
function tamanhoCurto(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function avisoDe(texto: string, icone: string): ItemDaArvore {
  return new ItemDaArvore('aviso', '', [], '', texto, undefined, false, icone);
}

/** O grupo com este caminho, em qualquer profundidade. */
function acharGrupo(raiz: Grupo, caminho: string): Grupo | null {
  if (raiz.path === caminho) return raiz;
  for (const filho of raiz.groups) {
    const achado = acharGrupo(filho, caminho);
    if (achado !== null) return achado;
  }
  return null;
}
