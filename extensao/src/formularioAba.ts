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

/** Cria a aba, ou revela a que já existe. Comum ao cadastro e aos diálogos. */
function aba(
  deps: DepsDoPainel,
  chave: string,
  titulo: string,
  arquivo: 'formulario.js' | 'dialogo.js' | 'diagrama.js' | 'aba.js' | 'caderno.js',
  config: Record<string, unknown>,
  /**
   * O que reenviar quando a aba JÁ existe.
   *
   * Só a aba de resultado usa: o `▷ Run` do caderno cai sempre na mesma, e
   * revelar sem reenviar mostrava o resultado da execução ANTERIOR — um botão
   * que parece não fazer nada. Formulário e tabela não passam nada aqui de
   * propósito: reabrir um formulário tem de trazer de volta o que ele digitou,
   * e não apagá-lo.
   */
  dadosNovos?: Record<string, unknown>
): void {
  const jaAberta = abertas.get(chave);
  if (jaAberta !== undefined) {
    if (dadosNovos !== undefined) {
      void jaAberta.webview.postMessage({ tipo: 'novosDados', dados: dadosNovos });
    }
    // Revelar em vez de abrir de novo: duas abas do mesmo alvo divergiriam
    // sobre o mesmo dado.
    jaAberta.reveal();
    return;
  }

  const nova = vscode.window.createWebviewPanel(
    'braytech.formulario',
    titulo,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'webview')],
      // Sem isto, trocar de aba e voltar apagaria tudo que ele já digitou.
      retainContextWhenHidden: true,
    }
  );

  nova.webview.html = htmlDaWebview(nova.webview, deps.extensionUri, arquivo, {
    base: `http://127.0.0.1:${deps.motor.porta}`,
    ...config,
  });

  new PonteDoHost(deps, () => nova.dispose()).ligar(nova.webview);

  abertas.set(chave, nova);
  nova.onDidDispose(() => abertas.delete(chave));
}

export function abrirFormularioDeConexao(
  deps: DepsDoPainel,
  conexaoId: string | null,
  grupo: string,
  rotulo: string
): void {
  aba(
    deps,
    conexaoId ?? `nova:${grupo}`,
    conexaoId === null ? 'Nova conexão' : rotulo === '' ? 'Conexão' : rotulo,
    'formulario.js',
    { conexaoId, grupo }
  );
}

/**
 * Os diálogos ricos do painel — criar objeto e filtrar — também em aba.
 *
 * São os mesmos `DialogoDeCriacao` e `DialogoDeFiltro` da IDE. O que muda é o
 * quadro: numa coluna de 300 px eles colapsam do mesmo jeito que o cadastro
 * colapsou.
 */
export function abrirDialogoEmAba(
  deps: DepsDoPainel,
  dialogo: 'criacao' | 'filtro',
  pedido: unknown
): void {
  const p = pedido as { id?: string; rotulo?: string; caminho?: readonly string[] };
  const titulo = dialogo === 'criacao' ? `Criar em ${p.rotulo ?? ''}` : `Filtrar ${p.rotulo ?? ''}`;
  aba(deps, `${dialogo}:${p.id ?? ''}:${(p.caminho ?? []).join('/')}`, titulo, 'dialogo.js', {
    dialogo,
    pedido,
  });
}

/** O diagrama ER desenhado. Uma aba por schema. */
export function abrirDiagramaEmAba(
  deps: DepsDoPainel,
  titulo: string,
  markdown: string
): void {
  aba(deps, `diagrama:${titulo}`, titulo, 'diagrama.js', { markdown });
}

/**
 * Uma aba da IDE dentro do editor: tabela, chave, resultado, caderno.
 *
 * O tema, o tamanho da fonte e o tab do EDITOR vão junto — os painéis da IDE
 * pedem isso para colorir SQL, e usar os meus valores faria a aba discordar do
 * resto da janela.
 */
export function abrirAbaDaIde(
  deps: DepsDoPainel,
  tipo: string,
  titulo: string,
  dados: Record<string, unknown>
): void {
  const editor = vscode.workspace.getConfiguration('editor');
  const claro =
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
    vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;

  const comum = {
    tipo,
    titulo,
    tema: claro ? 'claro' : 'escuro',
    fontSize: editor.get<number>('fontSize') ?? 13,
    tabSize: editor.get<number>('tabSize') ?? 2,
  };

  if (tipo === 'caderno') {
    aba(deps, `caderno:${String(dados.caminho)}`, titulo, 'caderno.js', {
      ...comum,
      ...dados,
      // O conteúdo é lido pelo HOST: o `file://` do disco não é acessível de
      // dentro da webview, e o motor já tem a rota.
      conteudo: dados.conteudo ?? '',
    });
    return;
  }

  aba(
    deps,
    `${tipo}:${titulo}`,
    titulo,
    'aba.js',
    { ...comum, dados },
    tipo === 'resultado' ? dados : undefined
  );
}
