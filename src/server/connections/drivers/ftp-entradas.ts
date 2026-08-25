// Converter o que o `basic-ftp` devolve no `RemoteEntry` do contrato (spec 057).
//
// Puro e separado do driver pelo mesmo motivo do `ssh-entradas`: aqui mora a
// tradução entre dois vocabulários, e tradução se acerta com teste.
//
// **O FTP sabe menos que o SFTP.** Ele lista o que o servidor quis contar, e o
// que ele conta varia com o sistema do outro lado: um servidor Windows não tem
// dono nem permissão, e um servidor antigo não tem hora — só data. O que falta
// vira `null`, e a tela mostra `--`, que é a verdade.
import { juntar } from '../../../shared/remoto/caminho';
import type { RemoteEntry, RemoteEntryKind } from '../types';

/** Os tipos do `basic-ftp`, sem importar o enum dele para cá. */
export const TIPO_ARQUIVO = 1;
export const TIPO_PASTA = 2;
export const TIPO_LINK = 3;

export interface ItemDoFtp {
  readonly name: string;
  readonly type: number;
  readonly size: number;
  readonly modifiedAt?: Date;
  readonly rawModifiedAt?: string;
  readonly user?: string;
  readonly permissions?: unknown;
}

export function tipoDoFtp(type: number): RemoteEntryKind {
  if (type === TIPO_PASTA) return 'folder';
  if (type === TIPO_LINK) return 'link';
  return 'file';
}

export interface EntradaDeFtp extends RemoteEntry {
  readonly executable: boolean;
}

export function entradaDeFtp(pasta: string, item: ItemDoFtp): EntradaDeFtp {
  const kind = tipoDoFtp(item.type);
  const quando = item.modifiedAt;
  return {
    name: item.name,
    path: juntar(pasta, item.name),
    kind,
    // Pasta não mostra tamanho, pela mesma razão do SFTP: o número que o
    // servidor dá é o do próprio diretório, e ao lado do nome ele se confunde
    // com "o que tem dentro".
    size: kind === 'folder' ? null : item.size,
    modifiedAt:
      quando instanceof Date && !Number.isNaN(quando.getTime()) ? quando.getTime() : null,
    owner: item.user === undefined || item.user === '' ? undefined : item.user,
    // FTP não tem `Execute shell` — não há como executar nada por FTP. O campo
    // existe para a tela poder ser a mesma; o valor é sempre falso.
    executable: false,
  };
}
