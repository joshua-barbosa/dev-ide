"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// A casca de desktop: sobe o MESMO servidor e o carrega numa janela (T094).
//
// **Casca fina de propósito.** Nada de lógica de IDE aqui: o servidor é o mesmo
// arquivo que o `npm start` executa, e a interface é o mesmo bundle que o
// navegador carrega. O que muda é quem hospeda — e é por isso que o modo
// navegador continua funcionando depois deste lote.
//
// A porta é EFÊMERA. Fixar 4321 faria a versão desktop brigar com um `npm start`
// esquecido, e o erro apareceria como uma janela branca.
const electron_1 = require("electron");
const net = __importStar(require("node:net"));
const path = __importStar(require("node:path"));
const janela_1 = require("./janela");
/** Uma porta que o sistema diz estar livre agora. */
async function portaLivre() {
    return new Promise((resolver, rejeitar) => {
        const s = net.createServer();
        s.on('error', rejeitar);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolver(port));
        });
    });
}
let janela = null;
async function criarJanela(porta) {
    const telas = electron_1.screen.getAllDisplays().map((d) => ({
        x: d.workArea.x,
        y: d.workArea.y,
        largura: d.workArea.width,
        altura: d.workArea.height,
    }));
    const onde = (0, janela_1.ondeAbrir)(null, telas);
    janela = new electron_1.BrowserWindow({
        x: onde.x === 0 ? undefined : onde.x,
        y: onde.y === 0 ? undefined : onde.y,
        width: onde.largura,
        height: onde.altura,
        // A janela nasce ESCONDIDA e aparece quando a interface está pronta. Sem
        // isso, o primeiro quadro é um retângulo branco — e o Monaco medido numa
        // janela ainda sem tamanho vira aquele editor de cinco por cinco pixels.
        show: false,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    janela.once('ready-to-show', () => janela?.show());
    // Link para fora vai para o navegador do sistema. Dentro da janela não há
    // barra de endereços, então uma navegação para fora seria um beco sem saída.
    janela.webContents.setWindowOpenHandler(({ url }) => {
        void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    janela.webContents.on('will-navigate', (e, url) => {
        if ((0, janela_1.ehDaPropriaIde)(url, porta))
            return;
        e.preventDefault();
        void electron_1.shell.openExternal(url);
    });
    janela.on('closed', () => {
        janela = null;
    });
    await janela.loadURL((0, janela_1.enderecoDaJanela)(porta));
}
/** O diálogo NATIVO de pasta (T003) — o que o navegador não consegue dar. */
electron_1.ipcMain.handle('dev-ide:escolher-pasta', async (_e, titulo) => {
    const alvo = janela;
    if (alvo === null)
        return null;
    const r = await electron_1.dialog.showOpenDialog(alvo, {
        title: typeof titulo === 'string' && titulo !== '' ? titulo : 'Abrir pasta',
        properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
});
/** Se o chaveiro está utilizável AGORA (T099) — no Linux depende do keyring. */
electron_1.ipcMain.handle('dev-ide:chaveiro-disponivel', () => electron_1.safeStorage.isEncryptionAvailable());
async function iniciar() {
    const porta = await portaLivre();
    process.env.PORT = String(porta);
    process.env.HOST = '127.0.0.1';
    // O MESMO servidor do `npm start`. Carregado aqui dentro para não haver um
    // segundo processo a matar — e o `require` roda o bootstrap dele, que só
    // escuta quando é o módulo principal... por isso o `iniciarServidor`.
    // O CHAVEIRO é registrado ANTES de o servidor carregar (T099): o
    // `RememberedKey` nasce na carga do módulo do servidor, e quem quiser trocar o
    // backend dele precisa falar antes disso.
    const remember = require('../server/connections/remember.js');
    const { chaveiroDoSistema } = require('./chaveiro-do-so.js');
    const ch = chaveiroDoSistema(electron_1.app.getPath('userData'));
    remember.registrarSeloDoSistema({
        disponivel: () => ch.disponivel(),
        selar: (texto) => electron_1.safeStorage.encryptString(texto),
        abrir: (dados) => electron_1.safeStorage.decryptString(dados),
    });
    const servidor = require('../server/index.js');
    await servidor.iniciarServidor(porta);
    await criarJanela(porta);
}
electron_1.app.whenReady().then(iniciar).catch((erro) => {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    electron_1.dialog.showErrorBox('A dev-ide não subiu', mensagem);
    electron_1.app.quit();
});
// No Linux e no Windows, fechar a janela fecha o aplicativo — é o que se espera
// de um editor. No macOS o costume é o contrário, e o costume de lá manda.
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
