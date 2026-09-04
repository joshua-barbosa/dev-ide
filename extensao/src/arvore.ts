// A árvore de conexões, na barra lateral do VS Code.
//
// São DUAS: `Databases` e `Services`, como na IDE própria. Quem decide em qual
// cada conexão entra é o DRIVER (`panel`, em `shared/contracts.ts`), e não uma
// lista escrita aqui — ver `paineis.ts`.
//
// O `TreeNode` do motor e o `TreeItem` do VS Code dizem quase a mesma coisa
// campo a campo, então a árvore é a NATIVA do editor: teclado, filtro, menu de
// contexto e acessibilidade de graça.

import * as vscode from 'vscode';
import type { Motor } from './motor';
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
  readonly openIds: readonly string[];
}

type Especie = 'grupo' | 'conexao' | 'no' | 'aviso' | 'query' | 'arquivo';

/** Um `.sql` ou `.sqlbook` da pasta `Query` de um database. */
interface ArquivoDeQuery {
  readonly nome: string;
  readonly caminho: string;
  readonly bytes: number;
  readonly modificadoEm: string;
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
    /** Só na pasta `Query` e nos arquivos dela: de qual database são. */
    readonly database = '',
    /** Só nos arquivos: o caminho em disco, para abrir no editor. */
    readonly arquivo = '',
    /** O `meta` que o driver mandou — é dele que sai `database` e `object`. */
    readonly meta: Readonly<Record<string, unknown>> = {}
  ) {
    super(
      rotulo,
      temFilhos
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    // O detalhe cinza do motor ("92", "8.0.40", "64.1G") é exatamente o que o
    // VS Code chama de `description`.
    if (detalhe !== undefined) this.description = detalhe;
    this.iconPath = new vscode.ThemeIcon(iconeDoVsCode(icone));
    // O `when` dos menus do `package.json` lê isto. Um nó COM ações declaradas
    // ganha sufixo próprio, para o item de menu não aparecer onde não há ação.
    this.contextValue = acoes.length > 0 ? `braytech.${especie}.comAcoes` : `braytech.${especie}`;
  }
}

/**
 * O ícone do motor traduzido para o do VS Code.
 *
 * O motor fala `lucide:table`; o editor tem um conjunto próprio. Um ícone
 * genérico no que faltar é melhor que um quadrado vazio, e muito melhor que a
 * extensão quebrar por causa de um nome que ela não conhece.
 */
function iconeDoVsCode(icone: string): string {
  const nome = icone.replace(/^lucide:/, '');
  const mapa: Readonly<Record<string, string>> = {
    database: 'database', schema: 'symbol-namespace', table: 'table',
    view: 'eye', column: 'symbol-field', columns: 'symbol-field',
    'file-text': 'file-code', eye: 'eye', key: 'key', folder: 'folder',
    server: 'server', zap: 'zap', 'git-branch': 'git-branch',
    hash: 'symbol-numeric', list: 'list-unordered', box: 'symbol-class',
    function: 'symbol-method', terminal: 'terminal', user: 'account',
    lock: 'lock', file: 'file', 'hard-drive': 'device-desktop',
  };
  return mapa[nome] ?? 'circle-outline';
}

export class ArvoreDeConexoes implements vscode.TreeDataProvider<ItemDaArvore> {
  private readonly mudou = new vscode.EventEmitter<ItemDaArvore | undefined>();
  readonly onDidChangeTreeData = this.mudou.event;

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
    // **Erro aqui não pode sumir.** O VS Code engole a rejeição de um
    // `getChildren` e desenha um nó vazio: o usuário clica, nada acontece, e
    // não há uma palavra na tela dizendo por quê. Foi exatamente o que ele viu.
    try {
      return await this.filhos(pai);
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : String(erro);
      void vscode.window.showErrorMessage(`Braytech Code: ${texto}`);
      return [avisoDe(texto, 'lucide:zap')];
    }
  }

  private async filhos(pai?: ItemDaArvore): Promise<ItemDaArvore[]> {
    if (pai?.especie === 'aviso') return [];

    if (pai === undefined) {
      const raiz = await this.lerRaiz();
      if (!raiz.vault.exists) return [avisoDe('Nenhum cofre ainda — crie uma conexão na IDE.', 'lucide:key')];
      // Cofre trancado não é erro: é o primeiro passo. Uma linha que se clica
      // vale mais que uma árvore vazia sem motivo aparente.
      if (!raiz.vault.unlocked) return [this.cofreTrancado()];

      const porTipo = painelPorTipo(await this.lerDrivers());
      const filtrada = filtrarPorPainel(raiz.tree, this.painel, porTipo);
      if (filtrada === null) return [];
      const itens = this.doGrupo(filtrada);
      return itens.length > 0
        ? itens
        : [avisoDe(`Nenhuma conexão de ${this.painel === 'database' ? 'banco' : 'serviço'}.`, 'lucide:folder')];
    }

    if (pai.especie === 'grupo') {
      const raiz = await this.lerRaiz();
      const porTipo = painelPorTipo(await this.lerDrivers());
      const filtrada = filtrarPorPainel(raiz.tree, this.painel, porTipo);
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
        n.label, n.detail, n.hasChildren, n.icon, n.actions ?? [], '', '', n.meta ?? {}
      );
      // **Quem tem linhas é quem o driver marcou com `meta.object`** — é o
      // mesmo campo que a IDE própria lê para abrir a query de um nó.
      //
      // Testar `hasChildren` seria errado, e foi o meu erro: uma tabela TEM
      // filhos (as colunas), então a prévia nunca dispararia justamente no nó
      // em que ela mais importa.
      if (typeof n.meta?.object === 'string') {
        item.command = {
          command: 'braytech.abrirNo',
          title: 'Ver linhas',
          arguments: [item],
        };
      }
      return item;
    });

    // **A categoria `Query` é NOSSA, não do driver.** Os arquivos são da IDE, e
    // pedir que cada driver liste arquivos que ele não conhece inverteria o
    // Artigo III. O driver declara que o nó é um database (`meta.database`); a
    // interface decide que isso merece uma pasta de queries — a mesma regra da
    // IDE própria (spec 038). Sem ela, os `.sqlbook` dele ficavam inalcançáveis.
    const database = typeof pai.meta?.database === 'string' ? pai.meta.database : null;
    if (database === null) return itens;
    return [pastaDeQuery(pai.conexao, pai.nodePath, database), ...itens];
  }

  /** Os `.sql` e `.sqlbook` de um database. */
  private async arquivosDeQuery(pai: ItemDaArvore): Promise<ItemDaArvore[]> {
    const arquivos = await this.motor.pedir<readonly ArquivoDeQuery[]>(
      'GET',
      `/api/queries?connectionId=${encodeURIComponent(pai.conexao)}` +
        `&database=${encodeURIComponent(pai.database)}`
    );
    if (arquivos.length === 0) {
      return [avisoDe('Nenhuma query ainda.', 'lucide:file-text')];
    }
    return arquivos.map((a) => {
      const item = new ItemDaArvore(
        'arquivo', pai.conexao, [], '', a.nome, tamanho(a.bytes), false,
        a.nome.endsWith('.sqlbook') ? 'lucide:list' : 'lucide:file-text',
        [], pai.database, a.caminho
      );
      item.command = {
        command: 'braytech.abrirArquivoDeQuery',
        title: 'Abrir',
        arguments: [item],
      };
      return item;
    });
  }

  /** Pastas antes de folhas — a mesma ordem da árvore de arquivos. */
  private doGrupo(grupo: Grupo): ItemDaArvore[] {
    const pastas = grupo.groups.map(
      (g) => new ItemDaArvore('grupo', '', [], g.path, g.name, undefined, true, 'lucide:folder')
    );
    // **Sem `command` na conexão, de propósito.** Um `TreeItem` com comando
    // executa o comando no clique em vez de expandir, e era isso que fazia a
    // árvore não abrir: clicar na conexão só trocava a conexão ativa, calado.
    // Quem marca a ativa agora é a SELEÇÃO da árvore, em `extension.ts`.
    const conexoes = grupo.connections.map(
      (c: ConexaoPublica) =>
        new ItemDaArvore('conexao', c.id, [], '', c.label, c.type, true, 'lucide:database')
    );
    return [...pastas, ...conexoes];
  }

  private cofreTrancado(): ItemDaArvore {
    const item = avisoDe('Cofre trancado — clique para destrancar', 'lucide:key');
    item.command = { command: 'braytech.destrancarCofre', title: 'Destrancar o cofre' };
    return item;
  }

  private lerRaiz(): Promise<RaizDoMotor> {
    this.raiz ??= this.motor.pedir<RaizDoMotor>('GET', '/api/connections');
    return this.raiz;
  }

  private lerDrivers(): Promise<readonly DriverPublico[]> {
    // O catálogo de drivers não muda enquanto o motor vive: uma vez basta.
    this.drivers ??= this.motor.pedir<readonly DriverPublico[]>(
      'GET',
      '/api/connections/drivers'
    );
    return this.drivers;
  }
}

function pastaDeQuery(
  conexao: string,
  nodePath: readonly string[],
  database: string
): ItemDaArvore {
  return new ItemDaArvore(
    'query', conexao, nodePath, '', 'Query', undefined, true, 'lucide:folder', [], database
  );
}

/** "12.0K", "3.4M" — o mesmo formato que o motor usa no detalhe da árvore. */
function tamanho(bytes: number): string {
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
