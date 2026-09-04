// Arquivos de SSH, SFTP e FTP como arquivos de verdade do editor.
//
// Ele disse que **usa a ferramenta de SSH exatamente para editar, criar e
// apagar arquivo**. Abrir uma cópia sem volta seria pior que não abrir: daria a
// impressão de funcionar e perderia o trabalho no primeiro Ctrl+S.
//
// Por isso não é uma aba de texto solto, e sim um `FileSystemProvider` no
// esquema `braytech:`. Com ele o VS Code trata o arquivo remoto como qualquer
// outro — abre, edita, salva, mostra "não salvo", desfaz — e quem grava no
// servidor é o motor, pelas mesmas rotas da IDE.
//
// A URI é `braytech://<conexao>/<caminho>`. A autoridade é o id da conexão, o
// que faz dois servidores com o mesmo `/etc/hosts` serem dois arquivos.

import * as vscode from 'vscode';
import type { Motor } from './motor';

interface ArquivoRemoto {
  readonly content: string;
}

/** O caminho POSIX dentro do servidor. Remoto é POSIX por protocolo. */
function caminhoDe(uri: vscode.Uri): string {
  return uri.path === '' ? '/' : uri.path;
}

export function uriRemota(conexaoId: string, caminho: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'braytech',
    authority: conexaoId,
    path: caminho.startsWith('/') ? caminho : `/${caminho}`,
  });
}

export class ArquivosRemotos implements vscode.FileSystemProvider {
  private readonly mudou = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.mudou.event;

  /** Tamanho do que já foi lido, para o `stat` não mentir sobre o arquivo. */
  private readonly tamanhos = new Map<string, number>();

  constructor(private readonly motor: Motor) {}

  watch(): vscode.Disposable {
    // O motor não avisa mudança em arquivo remoto, e inventar um relógio que
    // relê de tempos em tempos gastaria a conexão dele para quase nunca achar
    // nada. Quem quiser o disco de novo usa Recarregar.
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: this.tamanhos.get(uri.toString()) ?? 0,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    // Quem navega pastas é o painel, com a árvore da IDE. Aqui só se abre o
    // arquivo que ele escolheu lá.
    return [];
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const r = await this.motor.pedir<ArquivoRemoto>(
      'GET',
      `/api/connections/${encodeURIComponent(uri.authority)}/files` +
        `?path=${encodeURIComponent(caminhoDe(uri))}`
    );
    const bytes = new TextEncoder().encode(r.content);
    this.tamanhos.set(uri.toString(), bytes.byteLength);
    return bytes;
  }

  async writeFile(uri: vscode.Uri, conteudo: Uint8Array): Promise<void> {
    const texto = new TextDecoder().decode(conteudo);
    await this.motor.pedir(
      'POST',
      `/api/connections/${encodeURIComponent(uri.authority)}/files`,
      { path: caminhoDe(uri), content: texto }
    );
    this.tamanhos.set(uri.toString(), conteudo.byteLength);
    this.mudou.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async delete(uri: vscode.Uri): Promise<void> {
    await this.motor.pedir(
      'DELETE',
      `/api/connections/${encodeURIComponent(uri.authority)}/files`,
      { path: caminhoDe(uri) }
    );
    this.mudou.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(de: vscode.Uri, para: vscode.Uri): Promise<void> {
    await this.motor.pedir(
      'POST',
      `/api/connections/${encodeURIComponent(de.authority)}/files/rename`,
      { path: caminhoDe(de), to: caminhoDe(para) }
    );
    this.mudou.fire([
      { type: vscode.FileChangeType.Deleted, uri: de },
      { type: vscode.FileChangeType.Created, uri: para },
    ]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    await this.motor.pedir(
      'POST',
      `/api/connections/${encodeURIComponent(uri.authority)}/files/mkdir`,
      { path: caminhoDe(uri) }
    );
  }
}
