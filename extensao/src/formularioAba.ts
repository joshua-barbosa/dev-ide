// O formulário de conexão como ABA do editor.
//
// Ele viu o formulário espremido na barra lateral, com rolagem dentro de
// rolagem e o campo Grupo escrito `[object Object]`, e disse: *"não é para
// abrir como webview... olha como fica horrível isso"*.
//
// O próprio `ConnectionForm` já dizia isso no primeiro comentário — "é aba, e
// não modal, porque um driver como o MySQL declara treze campos em quatro
// seções". Eu o tinha metido num `Dialog` de 300 px de largura. Aqui ele ocupa
// a área do editor, que é onde formulário de treze campos cabe.
//
// É o MESMO componente da IDE, com os mesmos drivers e a mesma gravação — o que
// muda é só o quadro em volta.

import * as vscode from 'vscode';
import { htmlDaWebview, PonteDoHost, type DepsDoPainel } from './ponteDoHost';

/** Uma aba por alvo: reabrir a mesma conexão traz de volta o que já está lá. */
const abertas = new Map<string, vscode.WebviewPanel>();

export function abrirFormularioDeConexao(
  deps: DepsDoPainel,
  conexaoId: string | null,
  grupo: string,
  rotulo: string
): void {
  const chave = conexaoId ?? `nova:${grupo}`;
  const jaAberta = abertas.get(chave);
  if (jaAberta !== undefined) {
    // Revelar em vez de abrir de novo: uma segunda aba do mesmo cadastro daria
    // dois formulários divergindo sobre a mesma conexão.
    jaAberta.reveal();
    return;
  }

  const titulo = conexaoId === null ? 'Nova conexão' : rotulo === '' ? 'Conexão' : rotulo;
  const aba = vscode.window.createWebviewPanel('braytech.formulario', titulo, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'webview')],
    // Sem isto, trocar de aba e voltar apagaria tudo que ele já digitou.
    retainContextWhenHidden: true,
  });

  aba.webview.html = htmlDaWebview(aba.webview, deps.extensionUri, 'formulario.js', {
    base: `http://127.0.0.1:${deps.motor.porta}`,
    conexaoId,
    grupo,
  });

  new PonteDoHost(deps, () => aba.dispose()).ligar(aba.webview);

  abertas.set(chave, aba);
  aba.onDidDispose(() => abertas.delete(chave));
}
