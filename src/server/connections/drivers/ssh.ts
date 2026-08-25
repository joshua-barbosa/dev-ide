// Driver SSH (spec 052) — o primeiro do painel `Service`.
//
// É também a primeira implementação dos contratos que a spec 005 declarou e
// nunca ninguém exerceu. O que o `RemoteFiles` prometia e o SFTP não entrega
// está anotado em `ssh-arquivos.ts`; o que precisou mudar no contrato mudou lá.
//
// Esta fase entrega **conectar e navegar**. Terminal, monitor, SFTP em tabela e
// encaminhamento de portas são as fases S3 a S7 — e a `Session` já tem os
// campos opcionais reservados para eles desde a spec 005, então entrar depois
// não mexe aqui.
import { ICONE_DE_SSH } from '../../../shared/icons';
import { lerFavoritos } from '../../favoritos';
import { conectar, type ClienteSsh } from './ssh-cliente';
import { camposDoSsh, lerConfigSsh, PORTA_PADRAO, type ConfigSsh } from './ssh-campos';
import { listarChaves } from './ssh-chaves';
import { lerDistribuicao, sistemaDe, type SistemaRemoto } from './ssh-diagnostico';
import { lerPasswd, usuariosDe, type UsuarioRemoto } from './ssh-entradas';
import { criarArquivosRemotos, listarEntradas, type ContextoDeArquivos } from './ssh-arquivos';
import { criarShellRemoto } from './ssh-terminal';
import {
  caminhoDoNo,
  noDeEntrada,
  noDeFavorito,
  noDeUsuario,
  nosDeAtalho,
  NO_FAVORITES,
  NO_USERS,
} from './ssh-arvore';
import type { Driver, ResolvedConfig, Session, TreeNode } from '../types';

/**
 * O que se descobre do servidor uma vez, ao conectar.
 *
 * São três comandos numa ida só: `uname`, `/etc/os-release` e `/etc/passwd`. Um
 * por vez seriam três viagens de rede antes de a árvore aparecer — e a árvore é
 * a primeira coisa que o usuário quer ver.
 */
interface RetratoDoServidor {
  readonly sistema: SistemaRemoto;
  readonly distribuicao: string | null;
  readonly donoPorUid: ReadonlyMap<number, string>;
  readonly usuarios: readonly UsuarioRemoto[];
}

const SEPARADOR = '===dev-ide===';

async function retratar(cliente: ClienteSsh): Promise<RetratoDoServidor> {
  const vazio: RetratoDoServidor = {
    sistema: 'desconhecido',
    distribuicao: null,
    donoPorUid: new Map(),
    usuarios: [],
  };
  try {
    const { stdout } = await cliente.executar(
      `uname -s; echo ${SEPARADOR}; cat /etc/os-release 2>/dev/null; ` +
        `echo ${SEPARADOR}; cat /etc/passwd 2>/dev/null`
    );
    const [uname = '', osRelease = '', passwd = ''] = stdout.split(SEPARADOR);
    return {
      sistema: sistemaDe(uname),
      distribuicao: lerDistribuicao(osRelease),
      donoPorUid: lerPasswd(passwd),
      usuarios: usuariosDe(passwd),
    };
  } catch {
    // Um servidor que recusa `exec` (shell restrito, `ForceCommand`) ainda serve
    // para SFTP. Perder a distro e a lista de usuários é menos ruim que não
    // conectar — a árvore aparece, com menos enfeite.
    return vazio;
  }
}

async function navegar(
  ctx: ContextoDeArquivos,
  retrato: RetratoDoServidor,
  favoritos: () => readonly string[],
  nodePath: readonly string[]
): Promise<TreeNode[]> {
  const destino = caminhoDoNo(ctx.raiz, nodePath);

  if (destino.tipo === 'raiz') {
    const entradas = await listarEntradas(ctx, ctx.raiz);
    return [
      ...nosDeAtalho(retrato.usuarios.length, favoritos().length),
      ...entradas.map(noDeEntrada),
    ];
  }

  if (destino.tipo === 'atalho') {
    if (destino.atalho === NO_USERS) return retrato.usuarios.map(noDeUsuario);
    if (destino.atalho === NO_FAVORITES) return favoritos().map(noDeFavorito);
    return [];
  }

  const entradas = await listarEntradas(ctx, destino.caminho ?? ctx.raiz);
  return entradas.map(noDeEntrada);
}

async function connect(config: ResolvedConfig): Promise<Session> {
  const ssh = lerConfigSsh(config.fields);
  const cliente = await conectar(ssh);
  const retrato = await retratar(cliente);

  const ctx: ContextoDeArquivos = {
    sftp: cliente.sftp,
    raiz: ssh.rootPath,
    prenderNaRaiz: ssh.pruneRoot,
    mostrarOcultos: ssh.showHidden,
    somenteLeitura: config.readOnly,
    donoPorUid: async () => retrato.donoPorUid,
  };

  // Lidos a cada navegação, e não capturados aqui: favoritar não pode exigir
  // reconectar para o nó aparecer.
  const favoritos = (): readonly string[] => lerFavoritos(config.id);

  return {
    kind: 'files',
    children: (nodePath) => navegar(ctx, retrato, favoritos, nodePath),
    files: criarArquivosRemotos(ctx),
    exec: (comando) => cliente.executar(comando),
    shell: criarShellRemoto(cliente.bruto(), ssh.shell),
    somenteLeitura: config.readOnly,
    // O que a árvore mostra ao lado do nome da conexão (AC-11).
    describe: async () => retrato.distribuicao,
    onClosed: cliente.aoFechar,
    close: async () => cliente.fechar(),
  };
}

export const sshDriver: Driver = {
  type: 'ssh',
  label: 'SSH',
  kind: 'files',
  panel: 'service',
  icon: ICONE_DE_SSH,
  defaultPort: PORTA_PADRAO,
  // Um getter, e não uma constante: as chaves de `~/.ssh` mudam entre uma
  // sessão e outra, e uma lista congelada na importação do módulo mostraria a
  // chave que o usuário apagou ontem e esconderia a que ele criou hoje.
  get fields() {
    return camposDoSsh(listarChaves().map((c) => ({ value: c.caminho, label: c.nome })));
  },
  connect,
};

export type { ConfigSsh };
