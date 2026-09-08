// Um `vscode` de mentira, com o que o host da extensão realmente toca.
//
// Não é para simular o editor: é para deixar o CÓDIGO DO HOST rodar em Node
// puro, contra um motor de verdade, e ver quais mensagens da webview são
// atendidas. Foi assim que se descobriu que as três rotas binárias nunca
// tinham funcionado dentro da extensão (spec 103) — nenhum teste as alcançava,
// porque alcançar exigia abrir o editor.
//
// As respostas dos diálogos são programáveis por `global.__RESPOSTAS`, e tudo
// que o host pediu ao editor fica em `global.__CHAMADAS`.
const fs = require('node:fs/promises');

const chamadas = [];
global.__CHAMADAS = chamadas;
const anota = (o) => {
  chamadas.push(o);
  return o;
};
/** O primeiro BOTÃO, pulando o objeto de opções do modal. */
const primeiroBotao = (args) => args.find((a) => typeof a === 'string');

const resposta = (chave, padrao) => {
  const r = global.__RESPOSTAS ?? {};
  return Object.prototype.hasOwnProperty.call(r, chave) ? r[chave] : padrao;
};

class Uri {
  constructor(caminho, esquema = 'file') {
    this.fsPath = caminho;
    this.path = caminho;
    this.scheme = esquema;
  }
  static file(p) { return new Uri(p); }
  // `file:///tmp/x` vira `/tmp/x`, como no editor: a soltura entrega URI, e um
  // `fsPath` com `file://` colado na frente não abriria arquivo nenhum.
  static parse(p) {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(String(p));
    if (m === null) return new Uri(String(p));
    return new Uri(decodeURIComponent(m[2]), m[1]);
  }
  static from(o) { return new Uri(o.path, o.scheme); }
  static joinPath(base, ...pedacos) { return new Uri([base.fsPath, ...pedacos].join('/')); }
  toString() { return `${this.scheme}:${this.fsPath}`; }
}

/** O que o `TreeItem` do editor guarda, e que a árvore preenche. */
class TreeItem {
  constructor(rotulo, estado) {
    this.label = rotulo;
    this.collapsibleState = estado;
  }
}

class ThemeIcon {
  constructor(id) { this.id = id; }
}
ThemeIcon.File = new ThemeIcon('file');
ThemeIcon.Folder = new ThemeIcon('folder');

module.exports = {
  Uri,
  TreeItem,
  ThemeIcon,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ViewColumn: { Active: -1, One: 1, Beside: -2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrastLight: 4 },
  TerminalLocation: { Editor: 2, Panel: 1 },
  EventEmitter: class {
    constructor() { this.event = () => ({ dispose() {} }); }
    fire(v) { this.ultimo = v; }
    dispose() {}
  },
  commands: { executeCommand: async (c, ...a) => anota({ o: 'executeCommand', c, a }) },
  window: {
    activeColorTheme: { kind: 2 },
    showInputBox: async (o) => (anota({ o: 'showInputBox', ...o }), resposta('showInputBox', 'texto')),
    showQuickPick: async (itens, o) =>
      (anota({ o: 'showQuickPick', itens, ...o }), resposta('showQuickPick', itens?.[0])),
    showSaveDialog: async (o) => (anota({ o: 'showSaveDialog', ...o }), resposta('showSaveDialog', undefined)),
    showOpenDialog: async (o) => (anota({ o: 'showOpenDialog', ...o }), resposta('showOpenDialog', undefined)),
    // O primeiro argumento depois da mensagem pode ser o objeto de OPÇÕES
    // (`{ modal: true }`) — e devolvê-lo como se fosse o botão fazia toda
    // confirmação modal ser lida como "cancelou". Foi assim que `Exportar
    // conexões` apareceu como "nem chamou" no arnês, sem defeito nenhum no
    // código de verdade.
    showInformationMessage: async (m, ...b) =>
      (anota({ o: 'info', m }), resposta('showInformationMessage', primeiroBotao(b))),
    showWarningMessage: async (m, ...b) =>
      (anota({ o: 'warn', m }), resposta('showWarningMessage', primeiroBotao(b))),
    showErrorMessage: async (m) => anota({ o: 'erro', m }),
    setStatusBarMessage: (m) => (anota({ o: 'statusBar', m }), { dispose() {} }),
    createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
    createWebviewPanel: () => {
      anota({ o: 'createWebviewPanel' });
      return {
        webview: {
          html: '',
          asWebviewUri: (u) => u,
          cspSource: '',
          onDidReceiveMessage() {},
          postMessage: async () => true,
        },
        reveal() {}, dispose() {}, onDidDispose() {},
      };
    },
    createTerminal: (o) => (anota({ o: 'createTerminal', nome: o?.name }), { show() {}, dispose() {} }),
    showTextDocument: async (d) => anota({ o: 'showTextDocument', d: String(d?.uri ?? d) }),
    registerTreeDataProvider: () => ({ dispose() {} }),
    createTreeView: (id, o) => (
      anota({ o: 'createTreeView', id, temSoltura: o?.dragAndDropController !== undefined }),
      { dispose() {}, onDidChangeVisibility() {} }
    ),
    withProgress: async (_o, tarefa) => tarefa({ report() {} }, { isCancellationRequested: false }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (k) => (k === 'fontSize' ? 13 : k === 'tabSize' ? 2 : undefined),
    }),
    openTextDocument: async (u) => (anota({ o: 'openTextDocument', u: String(u) }), { uri: u }),
    registerFileSystemProvider: () => ({ dispose() {} }),
    fs: {
      readFile: async (u) => new Uint8Array(await fs.readFile(u.fsPath)),
      // `stat` e `readDirectory` existem para a SOLTURA: uma pasta arrastada
      // sobe inteira, e quem a percorre é o `workspace.fs` — o mesmo que o
      // editor de verdade oferece.
      stat: async (u) => {
        const st = await fs.stat(u.fsPath);
        return { type: st.isDirectory() ? 2 : 1, size: st.size, ctime: 0, mtime: 0 };
      },
      readDirectory: async (u) => {
        const nomes = await fs.readdir(u.fsPath, { withFileTypes: true });
        return nomes.map((n) => [n.name, n.isDirectory() ? 2 : 1]);
      },
      writeFile: async (u, b) => {
        anota({ o: 'writeFile', caminho: u.fsPath, bytes: b.length });
        await fs.writeFile(u.fsPath, Buffer.from(b));
      },
    },
  },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  languages: { registerCompletionItemProvider: () => ({ dispose() {} }) },
  env: {
    clipboard: { writeText: async (t) => anota({ o: 'clipboard', t }) },
    openExternal: async () => true,
  },
};
