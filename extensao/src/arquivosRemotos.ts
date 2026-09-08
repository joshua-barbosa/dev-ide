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

/** Por quanto tempo os bytes lidos valem, entre o `stat` e o `readFile`. */
const VALIDADE_DO_CACHE_MS = 5_000;

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

  /**
   * Os bytes já lidos, por pouco tempo.
   *
   * O editor chama `stat` ANTES de `readFile`, e um `stat` que devolve tamanho
   * zero faz a prévia de imagem desistir. Como não há rota de `stat` no motor,
   * o tamanho honesto sai da própria leitura — e guardá-la por alguns segundos
   * evita ler o mesmo arquivo duas vezes para abrir uma vez.
   */
  private readonly cache = new Map<string, { bytes: Uint8Array; em: number }>();

  constructor(private readonly motor: Motor) {}

  /**
   * Os bytes do arquivo, **como estão**.
   *
   * Pela rota binária, e não pela de texto: a de texto devolve o conteúdo já
   * decodificado em UTF-8, e um PNG que passa por isso volta CORROMPIDO. Foi
   * assim que abrir uma imagem virou *"File seems to be binary and cannot be
   * opened as text"* — e, mesmo que abrisse, o arquivo estaria estragado.
   */
  private async ler(uri: vscode.Uri): Promise<Uint8Array> {
    const chave = uri.toString();
    const guardado = this.cache.get(chave);
    if (guardado !== undefined && Date.now() - guardado.em < VALIDADE_DO_CACHE_MS) {
      return guardado.bytes;
    }
    const bytes = await this.motor.pedirBytes(
      'GET',
      `/api/connections/${encodeURIComponent(uri.authority)}/files/bytes` +
        `?path=${encodeURIComponent(caminhoDe(uri))}`
    );
    this.cache.set(chave, { bytes, em: Date.now() });
    return bytes;
  }

  watch(): vscode.Disposable {
    // O motor não avisa mudança em arquivo remoto, e inventar um relógio que
    // relê de tempos em tempos gastaria a conexão dele para quase nunca achar
    // nada. Quem quiser o disco de novo usa Recarregar.
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      // O tamanho de verdade: a prévia de imagem o consulta antes de desenhar.
      size: (await this.ler(uri)).byteLength,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    // Quem navega pastas é o painel, com a árvore da IDE. Aqui só se abre o
    // arquivo que ele escolheu lá.
    return [];
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this.ler(uri);
  }

  /**
   * Grava **em bytes**, pela rota de upload.
   *
   * A rota de texto passaria o conteúdo por UTF-8, e salvar um binário por ela
   * o destruiria — inclusive um arquivo que ele só abriu para olhar e o editor
   * salvou por formatação automática.
   */
  async writeFile(uri: vscode.Uri, conteudo: Uint8Array): Promise<void> {
    await this.motor.pedirBytes(
      'POST',
      `/api/connections/${encodeURIComponent(uri.authority)}/files/upload` +
        `?path=${encodeURIComponent(caminhoDe(uri))}`,
      conteudo
    );
    this.cache.set(uri.toString(), { bytes: conteudo, em: Date.now() });
    this.mudou.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async delete(uri: vscode.Uri): Promise<void> {
    await this.motor.pedir(
      'DELETE',
      `/api/connections/${encodeURIComponent(uri.authority)}/files`,
      { path: caminhoDe(uri) }
    );
    this.cache.delete(uri.toString());
    this.mudou.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(de: vscode.Uri, para: vscode.Uri): Promise<void> {
    await this.motor.pedir(
      'POST',
      `/api/connections/${encodeURIComponent(de.authority)}/files/rename`,
      { path: caminhoDe(de), to: caminhoDe(para) }
    );
    this.cache.delete(de.toString());
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
