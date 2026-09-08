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
  readonly varios?: unknown;
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
): Promise<{ nome: string; carga: string } | null | { nome: string; carga: string }[]> {
  const extensoes = Array.isArray(a.extensoes) ? a.extensoes.map((e) => String(e)) : [];
  const varios = a.varios === true;

  const escolhidos = await vscode.window.showOpenDialog({
    canSelectMany: varios,
    openLabel: varios ? 'Enviar estes arquivos' : 'Usar este arquivo',
    ...(extensoes.length === 0 ? {} : { filters: { [extensoes.join('/')]: extensoes } }),
  });

  const ler = async (uri: vscode.Uri): Promise<{ nome: string; carga: string }> => ({
    nome: nomeSeguro(uri.path),
    carga: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('base64'),
  });

  // Com `varios`, a resposta é sempre uma LISTA — vazia se ele desistiu. Sem,
  // é um objeto ou `null`, como era. Duas formas porque quem pergunta por um
  // arquivo não quer testar tamanho de array para saber se houve resposta.
  if (varios) return Promise.all((escolhidos ?? []).map(ler));

  const uri = escolhidos?.[0];
  return uri === undefined ? null : ler(uri);
}
