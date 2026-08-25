// Converter o que o SFTP devolve no `RemoteEntry` do contrato (spec 052).
//
// Puro e separado do driver porque é aqui que mora a aritmética de bits do
// modo POSIX, e aritmética de bits é exatamente o tipo de coisa que se acerta
// com teste e se erra de cabeça.
//
// **O que o SFTP NÃO tem, e a tela de referência mostra assim mesmo:** data de
// criação. O protocolo (v3, que é o que praticamente todo servidor fala) carrega
// só `atime` e `mtime`. A ferramenta de referência escreve "Create Time" no
// tooltip, e o valor que ela mostra é o de acesso — ou seja, ela mente com
// segurança. Aqui o rótulo diz o que o dado é (D29).
import { ehOculto, juntar } from '../../../shared/remoto/caminho';
import type { RemoteEntry, RemoteEntryKind } from '../types';

/** Bits de tipo do modo POSIX. */
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

export function tipoDoModo(mode: number | undefined): RemoteEntryKind {
  if (mode === undefined) return 'file';
  const tipo = mode & S_IFMT;
  if (tipo === S_IFDIR) return 'folder';
  if (tipo === S_IFLNK) return 'link';
  return 'file';
}

/** As permissões em octal de quatro dígitos, como o `stat` mostra. */
export function modoOctal(mode: number | undefined): string | undefined {
  if (mode === undefined) return undefined;
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

/**
 * Dá para executar?
 *
 * Qualquer bit de execução serve: o `Execute shell` da S2 aparece para o que o
 * servidor deixaria rodar, e não só para o que o dono pode. Pasta não conta —
 * ali o bit `x` quer dizer "pode entrar", que é outra coisa.
 */
export function ehExecutavel(mode: number | undefined): boolean {
  if (mode === undefined) return false;
  if (tipoDoModo(mode) !== 'file') return false;
  return (mode & 0o111) !== 0;
}

/** Os tempos do SFTP vêm em SEGUNDOS; o contrato pede milissegundos. */
function paraMilissegundos(segundos: number | undefined): number | null {
  if (segundos === undefined || !Number.isFinite(segundos) || segundos <= 0) return null;
  return Math.round(segundos * 1000);
}

/** O que o `ssh2` entrega em cada item de `readdir`. */
export interface ItemDoSftp {
  readonly filename: string;
  readonly attrs: {
    readonly mode?: number;
    readonly size?: number;
    readonly uid?: number;
    readonly gid?: number;
    readonly atime?: number;
    readonly mtime?: number;
  };
}

export interface EntradaRemota extends RemoteEntry {
  /** Último acesso. O SFTP não tem criação — ver o cabeçalho deste arquivo. */
  readonly accessedAt: number | null;
  readonly executable: boolean;
}

export function entradaDe(
  pasta: string,
  item: ItemDoSftp,
  donoPorUid: ReadonlyMap<number, string>
): EntradaRemota {
  const kind = tipoDoModo(item.attrs.mode);
  const uid = item.attrs.uid;
  return {
    name: item.filename,
    path: juntar(pasta, item.filename),
    kind,
    // Tamanho de pasta não quer dizer nada (é o tamanho do próprio diretório no
    // disco), e mostrá-lo ao lado do nome confundiria com "o que tem dentro".
    size: kind === 'folder' ? null : (item.attrs.size ?? null),
    modifiedAt: paraMilissegundos(item.attrs.mtime),
    accessedAt: paraMilissegundos(item.attrs.atime),
    owner: uid === undefined ? undefined : (donoPorUid.get(uid) ?? String(uid)),
    mode: modoOctal(item.attrs.mode),
    executable: ehExecutavel(item.attrs.mode),
  };
}

/**
 * Ordena como a árvore de arquivos local (spec 012): pastas antes, e o resto em
 * ordem de gente — `localeCompare`, que põe `Ácido` perto de `Acido`.
 *
 * O link fica junto dos arquivos: ele pode apontar para pasta, e descobrir isso
 * custaria um `stat` por item só para ordenar.
 */
export function ordenarEntradas(entradas: readonly EntradaRemota[]): readonly EntradaRemota[] {
  return [...entradas].sort((a, b) => {
    const pastaA = a.kind === 'folder' ? 0 : 1;
    const pastaB = b.kind === 'folder' ? 0 : 1;
    if (pastaA !== pastaB) return pastaA - pastaB;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

export function filtrarOcultos(
  entradas: readonly EntradaRemota[],
  mostrar: boolean
): readonly EntradaRemota[] {
  return mostrar ? entradas : entradas.filter((e) => !ehOculto(e.name));
}

/**
 * `uid` → nome, lido do `/etc/passwd`.
 *
 * O SFTP entrega número, e a coluna `OWNER` da tela mostra nome. Uma leitura por
 * sessão resolve a árvore inteira; perguntar por item seria uma ida ao servidor
 * por linha de listagem.
 *
 * Tolerante por obrigação: `/etc/passwd` pode ter linha de comentário, linha
 * curta, e num servidor com LDAP pode nem listar o usuário. Quem não estiver lá
 * aparece pelo número, que é a verdade disponível.
 */
export function lerPasswd(conteudo: string): ReadonlyMap<number, string> {
  const mapa = new Map<number, string>();
  for (const linha of conteudo.split('\n')) {
    if (linha.startsWith('#') || linha.trim() === '') continue;
    const partes = linha.split(':');
    const nome = partes[0];
    const uid = Number(partes[2]);
    if (nome === undefined || nome === '' || !Number.isInteger(uid)) continue;
    if (!mapa.has(uid)) mapa.set(uid, nome);
  }
  return mapa;
}

/** Um usuário de verdade — os que a tela lista sob `Users`. */
export interface UsuarioRemoto {
  readonly nome: string;
  readonly uid: number;
  readonly home: string;
}

/** Shells que significam "esta conta não é de gente". */
const SHELLS_SEM_LOGIN = ['/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/usr/bin/false'];

/**
 * Os usuários que valem aparecer na árvore.
 *
 * Critério: `root`, mais as contas com shell de login. Um servidor Debian tem
 * quarenta entradas em `/etc/passwd` — `daemon`, `bin`, `sys`, `www-data` —, e
 * listar todas transformaria o nó `Users` num despejo. O que o usuário quer ali
 * é chegar rápido na casa de alguém.
 */
export function usuariosDe(passwd: string): readonly UsuarioRemoto[] {
  const achados: UsuarioRemoto[] = [];
  for (const linha of passwd.split('\n')) {
    if (linha.startsWith('#') || linha.trim() === '') continue;
    const [nome, , uidBruto, , , home, shell] = linha.split(':');
    const uid = Number(uidBruto);
    if (nome === undefined || home === undefined || !Number.isInteger(uid)) continue;
    if (home === '' || home === '/' || home === '/nonexistent') continue;
    if (uid !== 0 && SHELLS_SEM_LOGIN.includes((shell ?? '').trim())) continue;
    if (uid !== 0 && uid < 1000) continue;
    // `nobody` tem uid 65534 e não é conta de gente em lugar nenhum.
    if (uid === 65534) continue;
    achados.push({ nome, uid, home });
  }
  return achados.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
