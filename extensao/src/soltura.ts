// O que chega quando ele SOLTA um arquivo na árvore.
//
// Ele, em 08/09/2026: *"eu arrasto e posiciono na pasta que eu quero subir e
// não vai"* — e não ia MESMO, calado. A árvore declarava só `files` como tipo
// de soltura, e o editor nem entrega o gesto quando o tipo não está declarado:
// arrastar do Explorer, ou do gerenciador de arquivos do sistema, chega como
// `text/uri-list`.
//
// Separado da árvore porque ela bateu no teto de 800 linhas do Artigo IV — e
// porque isto aqui é lido do `dataTransfer` e do disco, sem nada de árvore.
import * as vscode from 'vscode';
import * as path from 'node:path';

/** Teto da varredura de uma pasta solta, para um `node_modules` não travar tudo. */
const LIMITE_DE_ARQUIVOS = 2000;
const LIMITE_DE_FUNDO = 20;

/**
 * O que veio no `dataTransfer`, já lido em bytes.
 *
 * **Três formas, porque o editor usa as três.** Arquivo do sistema chega em
 * `files` (um item por arquivo); do Explorer do editor, e do gerenciador de
 * arquivos em várias plataformas, chega em `text/uri-list` — uma URI por
 * linha. Ler só a primeira era o que fazia o arraste parecer que "não foi".
 *
 * O `nome` pode trazer barra: uma PASTA solta sobe inteira, e o caminho
 * relativo é o que recria a estrutura do outro lado.
 */
export async function arquivosSoltos(
  dados: vscode.DataTransfer
): Promise<readonly { nome: string; bytes: Uint8Array }[]> {
  const lidos: { nome: string; bytes: Uint8Array }[] = [];
  const vistos = new Set<string>();

  const guardar = (nome: string, bytes: Uint8Array): void => {
    if (nome === '' || vistos.has(nome) || lidos.length >= LIMITE_DE_ARQUIVOS) return;
    vistos.add(nome);
    lidos.push({ nome, bytes });
  };

  /** Um caminho do disco: arquivo vira um item; pasta, tudo que há dentro. */
  const percorrer = async (uri: vscode.Uri, prefixo: string, fundo: number): Promise<void> => {
    if (fundo > LIMITE_DE_FUNDO || lidos.length >= LIMITE_DE_ARQUIVOS) return;
    const nome = path.posix.basename(uri.path) || path.basename(uri.fsPath);
    let tipo: vscode.FileType;
    try {
      tipo = (await vscode.workspace.fs.stat(uri)).type;
    } catch {
      return;
    }
    if ((tipo & vscode.FileType.Directory) !== 0) {
      const dentro = await vscode.workspace.fs.readDirectory(uri);
      for (const [filho] of dentro) {
        await percorrer(vscode.Uri.joinPath(uri, filho), `${prefixo}${nome}/`, fundo + 1);
      }
      return;
    }
    try {
      guardar(`${prefixo}${nome}`, await vscode.workspace.fs.readFile(uri));
    } catch {
      // Link quebrado ou sem permissão: pula um, e não a soltura inteira.
    }
  };

  // 1. Todo item que SAIBA virar arquivo, sob qualquer mime — vários arquivos
  //    chegam como vários itens, e `get('files')` devolveria só um.
  const itens: vscode.DataTransferItem[] = [];
  try {
    dados.forEach((item) => itens.push(item));
  } catch {
    // Editor que não sabe percorrer o `dataTransfer`: fica o caminho das URIs
    // abaixo, em vez de a soltura inteira morrer por causa disto.
  }
  for (const item of itens) {
    const agrupados: unknown[] = Array.isArray(item.value) ? item.value : [item];
    for (const bruto of agrupados) {
      const arquivo =
        typeof (bruto as vscode.DataTransferItem).asFile === 'function'
          ? (bruto as vscode.DataTransferItem).asFile()
          : (bruto as vscode.DataTransferFile | undefined);
      if (arquivo === undefined || typeof arquivo.name !== 'string') continue;
      // Com URI, passa pelo disco: é o que faz uma PASTA solta subir inteira,
      // porque `data()` de uma pasta não devolve nada útil.
      if (arquivo.uri !== undefined) {
        await percorrer(arquivo.uri, '', 0);
        continue;
      }
      if (typeof arquivo.data !== 'function') continue;
      guardar(path.basename(arquivo.name), await arquivo.data());
    }
  }

  // 2. As URIs. Uma por linha, e `#` é comentário — é o formato do padrão.
  const lista = dados.get('text/uri-list');
  const texto = lista === undefined ? '' : await valorEmTexto(lista);
  for (const linha of texto.split(/\r?\n/)) {
    const crua = linha.trim();
    if (crua === '' || crua.startsWith('#')) continue;
    try {
      await percorrer(vscode.Uri.parse(crua, true), '', 0);
    } catch {
      // URI que nem parseia: segue.
    }
  }
  return lidos;
}

/** O valor de um item do `dataTransfer` como texto. */
async function valorEmTexto(item: vscode.DataTransferItem): Promise<string> {
  try {
    const s = await item.asString();
    if (s !== '') return s;
  } catch {
    // Item que não sabe virar texto: cai no `value`.
  }
  return typeof item.value === 'string' ? item.value : '';
}

