// Salvar e escolher arquivo pelo diálogo NATIVO do editor.
//
// Dentro de uma webview, `<a download>` e `<input type="file">` não funcionam,
// e falham calados: o clique não faz nada e não aparece erro nenhum. O painel
// pede isto ao host — que é Node, tem acesso a disco e tem os diálogos do
// editor, que são melhores que os do navegador porque escolhem a PASTA.
//
// A carga é base64 porque entre a webview e aqui só passa JSON, e JSON não tem
// bytes. Ver `src/shared/arquivos/carga.ts`, do outro lado da fronteira.
import * as vscode from 'vscode';

/** O que o painel manda ao pedir para salvar. */
interface PedidoDeSalvar {
  readonly nome?: unknown;
  readonly carga?: unknown;
}

/** O que o painel manda ao pedir um arquivo. */
interface PedidoDeEscolher {
  readonly extensoes?: unknown;
}

/** Só o nome, nunca um caminho: o nome pode ter vindo de um servidor remoto. */
function nomeSeguro(bruto: unknown): string {
  const pedacos = String(bruto ?? '')
    .split(/[/\\]/)
    .filter((p) => p !== '' && p !== '.' && p !== '..');
  return pedacos[pedacos.length - 1] ?? 'arquivo';
}

/**
 * Grava um arquivo onde o usuário escolher. Devolve `null` se ele desistir.
 *
 * A pasta inicial é a última que ele usou, que é o que o `showSaveDialog` faz
 * sozinho quando o `defaultUri` é só um nome.
 */
export async function salvarArquivo(a: PedidoDeSalvar): Promise<null> {
  const nome = nomeSeguro(a.nome);
  const destino = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(nome) });
  if (destino === undefined) return null;

  await vscode.workspace.fs.writeFile(destino, Buffer.from(String(a.carga ?? ''), 'base64'));
  void vscode.window.showInformationMessage(`Braytech Code: ${nome} salvo.`);
  return null;
}

/**
 * Pede um arquivo e devolve nome + conteúdo em base64 — `null` se ele desistir.
 *
 * As extensões chegam como lista (`['json']`), e não como um `accept` de MIME:
 * é o que o diálogo do editor pede, e evita duas interpretações da mesma
 * string em lados diferentes da fronteira.
 */
export async function escolherArquivo(
  a: PedidoDeEscolher
): Promise<{ nome: string; carga: string } | null> {
  const extensoes = Array.isArray(a.extensoes) ? a.extensoes.map((e) => String(e)) : [];

  const escolhido = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Usar este arquivo',
    ...(extensoes.length === 0 ? {} : { filters: { [extensoes.join('/')]: extensoes } }),
  });
  const uri = escolhido?.[0];
  if (uri === undefined) return null;

  const bytes = await vscode.workspace.fs.readFile(uri);
  return { nome: nomeSeguro(uri.path), carga: Buffer.from(bytes).toString('base64') };
}
