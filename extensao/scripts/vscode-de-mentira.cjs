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
const resposta = (chave, padrao) => {
  const r = global.__RESPOSTAS ?? {};
  return Object.prototype.hasOwnProperty.call(r, chave) ? r[chave] : padrao;
};

class Uri {
  constructor(caminho) {
    this.fsPath = caminho;
    this.path = caminho;
    this.scheme = 'file';
  }
  static file(p) { return new Uri(p); }
  static parse(p) { return new Uri(p); }
  static joinPath(base, ...pedacos) { return new Uri([base.fsPath, ...pedacos].join('/')); }
  toString() { return this.fsPath; }
}

module.exports = {
  Uri,
  ThemeIcon: class { constructor(id) { this.id = id; } },
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
    showInformationMessage: async (m, ...b) =>
      (anota({ o: 'info', m }), resposta('showInformationMessage', b[0])),
    showWarningMessage: async (m, ...b) => (anota({ o: 'warn', m }), resposta('showWarningMessage', b[0])),
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
    createTreeView: () => ({ dispose() {}, onDidChangeVisibility() {} }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (k) => (k === 'fontSize' ? 13 : k === 'tabSize' ? 2 : undefined),
    }),
    openTextDocument: async (u) => (anota({ o: 'openTextDocument', u: String(u) }), { uri: u }),
    registerFileSystemProvider: () => ({ dispose() {} }),
    fs: {
      readFile: async (u) => new Uint8Array(await fs.readFile(u.fsPath)),
      writeFile: async (u, b) => {
        anota({ o: 'writeFile', caminho: u.fsPath, bytes: b.length });
        await fs.writeFile(u.fsPath, Buffer.from(b));
      },
    },
  },
  languages: { registerCompletionItemProvider: () => ({ dispose() {} }) },
  env: {
    clipboard: { writeText: async (t) => anota({ o: 'clipboard', t }) },
    openExternal: async () => true,
  },
};
