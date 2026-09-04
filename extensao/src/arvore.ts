// A árvore de conexões, na barra lateral do VS Code.
//
// O `TreeNode` do motor (`shared/contracts.ts`) e o `TreeItem` do VS Code dizem
// quase a mesma coisa — `label`, `description`, `collapsibleState`, `icon`. Foi
// a primeira surpresa boa desta prova de conceito: **a árvore não precisa de
// webview nenhuma.** É a árvore nativa do editor, com teclado, busca, filtro e
// menu de contexto de graça.
//
// O Artigo III continua valendo do jeito certo: o driver declara (`children`,
// `hasChildren`, `icon`), e aqui só se obedece.

import * as vscode from 'vscode';
import type { Motor } from './motor';

/** O que o motor devolve em `GET /api/connections/:id/children`. */
interface NoDoMotor {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly detail?: string;
  readonly hasChildren: boolean;
}

interface ConexaoPublica {
  readonly id: string;
  readonly label: string;
  readonly type: string;
}

/**
 * Os grupos são DERIVADOS do caminho, não entidades guardadas — a mesma
 * decisão do motor. Aqui eles viram pastas da árvore sem nenhum código a mais.
 */
interface GrupoDoMotor {
  readonly name: string;
  readonly path: string;
  readonly groups: readonly GrupoDoMotor[];
  readonly connections: readonly ConexaoPublica[];
}

interface RaizDoMotor {
  readonly vault: { readonly exists: boolean; readonly unlocked: boolean };
  readonly tree: GrupoDoMotor;
  readonly openIds: readonly string[];
}

type Especie = 'grupo' | 'conexao' | 'no';

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
    icone: string
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
    this.contextValue = `braytech.${especie}`;
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
    database: 'database',
    table: 'table',
    columns: 'symbol-field',
    'file-text': 'file-code',
    eye: 'eye',
    key: 'key',
    folder: 'folder',
    server: 'server',
    zap: 'zap',
    'git-branch': 'git-branch',
    hash: 'symbol-numeric',
    list: 'list-unordered',
    box: 'symbol-class',
    function: 'symbol-method',
    terminal: 'terminal',
  };
  return mapa[nome] ?? 'circle-outline';
}

export class ArvoreDeConexoes implements vscode.TreeDataProvider<ItemDaArvore> {
  private readonly mudou = new vscode.EventEmitter<ItemDaArvore | undefined>();
  readonly onDidChangeTreeData = this.mudou.event;

  constructor(private readonly motor: Motor) {}

  recarregar(): void {
    this.mudou.fire(undefined);
  }

  getTreeItem(item: ItemDaArvore): vscode.TreeItem {
    return item;
  }

  async getChildren(pai?: ItemDaArvore): Promise<ItemDaArvore[]> {
    const raiz = await this.motor.pedir<RaizDoMotor>('GET', '/api/connections');

    if (pai === undefined) {
      // Cofre trancado não é erro: é o primeiro passo. Uma linha que explica o
      // que fazer vale mais que uma árvore vazia sem motivo aparente.
      if (raiz.vault.exists && !raiz.vault.unlocked) return [this.cofreTrancado()];
      return this.doGrupo(raiz.tree);
    }

    if (pai.especie === 'grupo') {
      const grupo = acharGrupo(raiz.tree, pai.grupo);
      return grupo === null ? [] : this.doGrupo(grupo);
    }

    // Daqui para baixo quem responde é o driver, e a extensão só desenha.
    const busca = new URLSearchParams();
    for (const p of pai.nodePath) busca.append('path', p);
    const nos = await this.motor.pedir<NoDoMotor[]>(
      'GET',
      `/api/connections/${encodeURIComponent(pai.conexao)}/children?${busca.toString()}`
    );
    return nos.map(
      (n) =>
        new ItemDaArvore(
          'no',
          pai.conexao,
          [...pai.nodePath, n.id],
          '',
          n.label,
          n.detail,
          n.hasChildren,
          n.icon
        )
    );
  }

  /** Pastas antes de folhas — a mesma ordem da árvore de arquivos. */
  private doGrupo(grupo: GrupoDoMotor): ItemDaArvore[] {
    const pastas = grupo.groups.map(
      (g) => new ItemDaArvore('grupo', '', [], g.path, g.name, undefined, true, 'lucide:folder')
    );
    const conexoes = grupo.connections.map((c) => {
      const item = new ItemDaArvore(
        'conexao', c.id, [], '', c.label, c.type, true, 'lucide:database'
      );
      // Clicar na conexão a torna a ativa — é onde o Ctrl+Enter vai executar.
      item.command = {
        command: 'braytech.escolher',
        title: 'Usar esta conexão',
        arguments: [item],
      };
      return item;
    });
    return [...pastas, ...conexoes];
  }

  private cofreTrancado(): ItemDaArvore {
    const item = new ItemDaArvore(
      'grupo', '', [], '', 'Cofre trancado', 'clique para destrancar', false, 'lucide:key'
    );
    item.command = { command: 'braytech.destrancarCofre', title: 'Destrancar o cofre' };
    return item;
  }
}

/** O grupo com este caminho, em qualquer profundidade. */
function acharGrupo(raiz: GrupoDoMotor, caminho: string): GrupoDoMotor | null {
  if (raiz.path === caminho) return raiz;
  for (const filho of raiz.groups) {
    const achado = acharGrupo(filho, caminho);
    if (achado !== null) return achado;
  }
  return null;
}
