// A árvore remota da lateral (spec 052, AC-7 a AC-14).
//
// Três coisas debaixo da conexão, na ordem da ferramenta de referência:
// `Users`, `Favorites` e o conteúdo da raiz. As duas primeiras são atalhos —
// nós que a IDE inventa —, e é por isso que o caminho de um nó não é sempre o
// caminho no servidor: `['users', 'ana']` leva a `/home/ana`.
//
// A tradução mora aqui, num lugar só, e é o que impede o resto do driver de ter
// que saber que `users` é especial.
import { nomeDe } from '../../../shared/remoto/caminho';
import type { UsuarioRemoto } from './ssh-entradas';
import type { RemoteEntry } from '../types';

/** O que a árvore precisa saber de uma entrada, venha ela de SFTP ou de FTP. */
export interface EntradaDaArvore extends RemoteEntry {
  readonly executable: boolean;
  /** Só o SFTP tem. */
  readonly accessedAt?: number | null;
}
import type { TreeNode } from '../types';

export const NO_USERS = 'users';
export const NO_FAVORITES = 'favorites';

/** Quanto um arquivo tem, no formato curto que fica bem ao lado do nome. */
export function tamanhoCurto(bytes: number | null): string | undefined {
  if (bytes === null) return undefined;
  if (bytes < 1024) return `${bytes}B`;
  const unidades = ['K', 'M', 'G', 'T'];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  // Uma casa decimal só abaixo de 10: `1.5M` ajuda, `457.3K` é ruído.
  const texto = valor < 10 ? valor.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(valor));
  return `${texto}${unidades[i]}`;
}

/**
 * O tooltip de cada entrada (AC-10).
 *
 * Diz **modificado** e **acesso**, e não "criado": o SFTP v3 não carrega data
 * de criação, e a ferramenta de referência escreve "Create Time" sobre o valor
 * de acesso. Repetir o rótulo errado seria copiar a mentira junto com a tela.
 */
export function descricaoDeTempos(entrada: EntradaDaArvore): string | undefined {
  const quando = (ms: number | null): string | null =>
    ms === null ? null : new Date(ms).toLocaleString('pt-BR');
  const linhas: string[] = [];
  const mod = quando(entrada.modifiedAt);
  const aces = quando(entrada.accessedAt ?? null);
  if (mod !== null) linhas.push(`Modificado: ${mod}`);
  if (aces !== null) linhas.push(`Acesso: ${aces}`);
  if (entrada.mode !== undefined) linhas.push(`Permissão: ${entrada.mode}`);
  if (entrada.owner !== undefined) linhas.push(`Dono: ${entrada.owner}`);
  return linhas.length === 0 ? undefined : linhas.join('\n');
}

/** Que ícone a entrada pede. Link tem o próprio — ele não é o que parece. */
function iconeDe(entrada: EntradaDaArvore): string {
  if (entrada.kind === 'folder') return 'folder';
  if (entrada.kind === 'link') return 'link';
  return entrada.executable ? 'terminal' : 'file';
}

/**
 * Um nó da árvore a partir de uma entrada remota.
 *
 * Aceita o que QUALQUER driver de arquivos produz — o SFTP e o FTP (spec 057)
 * têm campos diferentes, e o que a árvore precisa é o subconjunto comum. Amarrar
 * esta função ao tipo do SSH faria o FTP desenhar a própria árvore, e as duas
 * divergiriam na primeira mudança.
 */
export function noDeEntrada(entrada: EntradaDaArvore): TreeNode {
  return {
    id: entrada.path,
    label: entrada.name,
    icon: iconeDe(entrada),
    detail: tamanhoCurto(entrada.size),
    // Link pode apontar para pasta, e descobrir isso custaria um `stat` por
    // item só para desenhar uma seta. Ele abre; se não for pasta, vem vazio.
    hasChildren: entrada.kind !== 'file',
    meta: {
      remotePath: entrada.path,
      kind: entrada.kind,
      executable: entrada.executable,
      size: entrada.size,
      modifiedAt: entrada.modifiedAt,
      accessedAt: entrada.accessedAt ?? null,
      owner: entrada.owner,
      mode: entrada.mode,
      tooltip: descricaoDeTempos(entrada),
    },
  };
}

/**
 * O nó de um usuário.
 *
 * O `id` é o HOME dele, e não `users/ana`, porque o caminho do nó que a rota
 * recebe é a corrente de ids — e um id que já é o caminho remoto faz a
 * navegação funcionar sem o driver ter que lembrar de onde o nó veio.
 */
export function noDeUsuario(usuario: UsuarioRemoto): TreeNode {
  return {
    id: usuario.home,
    label: usuario.nome,
    icon: 'folder',
    detail: usuario.home,
    hasChildren: true,
    meta: { remotePath: usuario.home, kind: 'folder' },
  };
}

export function noDeFavorito(caminho: string): TreeNode {
  return {
    id: caminho,
    label: nomeDe(caminho),
    icon: 'folder',
    detail: caminho,
    hasChildren: true,
    meta: { remotePath: caminho, kind: 'folder', favorito: true },
  };
}

/** Os dois atalhos, sempre no topo. */
export function nosDeAtalho(quantosUsuarios: number, quantosFavoritos: number): TreeNode[] {
  return [
    {
      id: NO_USERS,
      label: 'Users',
      icon: 'folder',
      detail: String(quantosUsuarios),
      // Sempre expansível, mesmo vazio: um atalho que não abre parece defeito,
      // e "(vazio)" é a resposta honesta. Vazio também era o que fazia o clique
      // cair no caminho de folha e abrir uma QUERY — visto no navegador.
      hasChildren: true,
      meta: { atalho: NO_USERS },
    },
    {
      id: NO_FAVORITES,
      label: 'Favorites',
      icon: 'key',
      // Zero aparece: um `Favorites` sem número pareceria não ter carregado.
      detail: String(quantosFavoritos),
      hasChildren: true,
      meta: { atalho: NO_FAVORITES },
    },
  ];
}

/**
 * Onde um caminho de nó cai no servidor.
 *
 * O caminho do nó é a corrente de **ids**, e todo nó que tem filhos remotos usa
 * o caminho absoluto como id. Então o último elemento já é a resposta — não é
 * preciso remontar nada nem carregar o `meta` do pai pela rota.
 *
 * As duas exceções são os atalhos, que a IDE inventa e o servidor não tem.
 */
export function caminhoDoNo(
  raiz: string,
  nodePath: readonly string[]
): { readonly tipo: 'raiz' | 'atalho' | 'remoto'; readonly atalho?: string; readonly caminho?: string } {
  const ultimo = nodePath[nodePath.length - 1];
  if (ultimo === undefined) return { tipo: 'raiz' };
  if (ultimo === NO_USERS || ultimo === NO_FAVORITES) {
    return { tipo: 'atalho', atalho: ultimo };
  }
  // Um id que não começa com `/` não veio desta árvore. Cair na raiz é melhor
  // que montar um caminho inventado a partir de nomes soltos.
  return { tipo: 'remoto', caminho: ultimo.startsWith('/') ? ultimo : raiz };
}
