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
import type { Motor } from './motor';
import { codiconDe, svgDaMarca } from './icones-do-editor';
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
  if (raizDosRecursos === null) return null;
  const arquivo = (tema: 'light' | 'dark'): vscode.Uri =>
    vscode.Uri.joinPath(raizDosRecursos as vscode.Uri, 'icones', `devicon-${marca}-${tema}.svg`);
  return { light: arquivo('light'), dark: arquivo('dark') };
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
    readonly meta: Readonly<Record<string, unknown>> = {}
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
      const svg = marca === null ? null : svgDeMarca(marca);
      // Marca fica colorida de propósito: é por ela que ele acha uma conexão de
      // relance na lista. O resto é `ThemeIcon`, que muda de cor com o tema.
      this.iconPath = svg ?? new vscode.ThemeIcon(codiconDe(icone));
    }

    this.contextValue = contextoDe(especie, acoes, remoto, meta);
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
  meta: Readonly<Record<string, unknown>> = {}
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
          ...(typeof meta.template === 'string' ? ['template'] : []),
        ];
  const capacidades = [
    ...(remoto === null ? [] : [remoto.ehPasta ? 'pastaRemota' : 'arquivoRemoto']),
    ...(meta.executable === true ? ['executavel'] : []),
    ...doDriver,
    // Estes dois são NOSSOS, e por isso vêm da espécie e não do `meta`.
    ...(especie === 'query' ? ['queries'] : []),
    ...(especie === 'arquivo' ? ['arquivoDeQuery'] : []),
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
  readonly dropMimeTypes = ['files'];
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

    const item = dados.get('files');
    const arquivos = await arquivosSoltos(item);
    if (arquivos.length === 0) {
      void vscode.window.showWarningMessage('O que foi solto não trouxe arquivo nenhum.');
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
    const busca = new URLSearchParams();
    for (const p of pai.nodePath) busca.append('path', p);
    const nos = await this.motor.pedir<NoDoMotor[]>(
      'GET',
      `/api/connections/${encodeURIComponent(pai.conexao)}/children?${busca.toString()}`
    );

    if (pai.especie === 'query') return this.arquivosDeQuery(pai);

    const itens = nos.map((n) => {
      const item = new ItemDaArvore(
        'no', pai.conexao, [...pai.nodePath, n.id], '',
        n.label, n.detail, n.hasChildren, n.icon, n.actions ?? [], n.meta ?? {}
      );
      // **Quem tem linhas é quem o driver marcou com `meta.object`.** Testar
      // `hasChildren` seria errado: uma tabela TEM filhos (as colunas), então a
      // prévia nunca dispararia justamente no nó em que ela mais importa.
      if (typeof n.meta?.object === 'string') {
        item.command = { command: 'braytech.abrirNo', title: 'Ver linhas', arguments: [item] };
      }
      // Arquivo remoto abre no editor, como abre na IDE.
      if (n.meta?.remotePath !== undefined && n.meta.kind === 'file') {
        item.command = {
          command: 'braytech.abrirArquivoRemoto',
          title: 'Abrir',
          arguments: [item],
        };
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
      { database, queries: true }
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
        { database, arquivo: a.caminho }
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
      const item = new ItemDaArvore(
        'conexao', c.id, [], grupo.path, c.label, c.type, true, this.iconeDoTipo(c.type),
        [],
        // O `meta` da conexão carrega o que os comandos precisam: editar pede
        // grupo e rótulo, e `Conectar`/`Desconectar` são itens diferentes.
        { grupo: grupo.path, rotulo: c.label, tipo: c.type, aberta: this.abertas.has(c.id) }
      );
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

/** O que veio no `dataTransfer`, já lido em bytes. */
async function arquivosSoltos(
  item: vscode.DataTransferItem | undefined
): Promise<readonly { nome: string; bytes: Uint8Array }[]> {
  if (item === undefined) return [];
  const lidos: { nome: string; bytes: Uint8Array }[] = [];
  // A API entrega UM arquivo por item; vários vêm como vários itens, e o
  // `asFile` do item agregado devolve o primeiro. Percorrer o `value` cobre os
  // dois formatos que o editor já usou.
  const candidatos: unknown[] = Array.isArray(item.value) ? item.value : [item];
  for (const bruto of candidatos) {
    const arquivo =
      typeof (bruto as vscode.DataTransferItem).asFile === 'function'
        ? (bruto as vscode.DataTransferItem).asFile()
        : (bruto as vscode.DataTransferFile | undefined);
    if (arquivo === undefined) continue;
    const dados = await arquivo.data();
    lidos.push({ nome: path.basename(arquivo.name), bytes: dados });
  }
  return lidos;
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
