// A casca de desktop: sobe o MESMO servidor e o carrega numa janela (T094).
//
// **Casca fina de propósito.** Nada de lógica de IDE aqui: o servidor é o mesmo
// arquivo que o `npm start` executa, e a interface é o mesmo bundle que o
// navegador carrega. O que muda é quem hospeda — e é por isso que o modo
// navegador continua funcionando depois deste lote.
//
// A porta é EFÊMERA. Fixar 4321 faria a versão desktop brigar com um `npm start`
// esquecido, e o erro apareceria como uma janela branca.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell } from 'electron';
import * as net from 'node:net';
import * as path from 'node:path';
import { ehDaPropriaIde, enderecoDaJanela, ondeAbrir, type Retangulo } from './janela';

/** Uma porta que o sistema diz estar livre agora. */
async function portaLivre(): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const s = net.createServer();
    s.on('error', rejeitar);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolver(port));
    });
  });
}

let janela: BrowserWindow | null = null;

async function criarJanela(porta: number): Promise<void> {
  const telas: Retangulo[] = screen.getAllDisplays().map((d) => ({
    x: d.workArea.x,
    y: d.workArea.y,
    largura: d.workArea.width,
    altura: d.workArea.height,
  }));
  const onde = ondeAbrir(null, telas);

  janela = new BrowserWindow({
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
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (ehDaPropriaIde(url, porta)) return;
    e.preventDefault();
    void shell.openExternal(url);
  });

  janela.on('closed', () => {
    janela = null;
  });

  await janela.loadURL(enderecoDaJanela(porta));
}

/** O diálogo NATIVO de pasta (T003) — o que o navegador não consegue dar. */
ipcMain.handle('dev-ide:escolher-pasta', async (_e, titulo: unknown) => {
  const alvo = janela;
  if (alvo === null) return null;
  const r = await dialog.showOpenDialog(alvo, {
    title: typeof titulo === 'string' && titulo !== '' ? titulo : 'Abrir pasta',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

/** Se o chaveiro está utilizável AGORA (T099) — no Linux depende do keyring. */
ipcMain.handle('dev-ide:chaveiro-disponivel', () => safeStorage.isEncryptionAvailable());

async function iniciar(): Promise<void> {
  const porta = await portaLivre();
  process.env.PORT = String(porta);
  process.env.HOST = '127.0.0.1';
  // O MESMO servidor do `npm start`. Carregado aqui dentro para não haver um
  // segundo processo a matar — e o `require` roda o bootstrap dele, que só
  // escuta quando é o módulo principal... por isso o `iniciarServidor`.
  // O CHAVEIRO é registrado ANTES de o servidor carregar (T099): o
  // `RememberedKey` nasce na carga do módulo do servidor, e quem quiser trocar o
  // backend dele precisa falar antes disso.
  const remember = require('../server/connections/remember.js') as {
    registrarSeloDoSistema(selo: unknown): void;
  };
  const { chaveiroDoSistema } = require('./chaveiro-do-so.js') as {
    chaveiroDoSistema(pasta: string): {
      disponivel(): boolean;
      guardar(c: Buffer): void;
      ler(): Buffer | null;
      esquecer(): void;
    };
  };
  const ch = chaveiroDoSistema(app.getPath('userData'));
  remember.registrarSeloDoSistema({
    disponivel: () => ch.disponivel(),
    selar: (texto: string) => safeStorage.encryptString(texto),
    abrir: (dados: Buffer) => safeStorage.decryptString(dados),
  });

  const servidor = require('../server/index.js') as {
    iniciarServidor(porta: number): Promise<void>;
  };
  await servidor.iniciarServidor(porta);
  await criarJanela(porta);
}

app.whenReady().then(iniciar).catch((erro: unknown) => {
  const mensagem = erro instanceof Error ? `${erro.message}\n\n${erro.stack ?? ''}` : String(erro);
  // No TERMINAL também, e não só no diálogo: quem roda o pacote pela linha de
  // comando para investigar não vê caixa de diálogo nenhuma, e ficaria com uma
  // janela que some sem dizer por quê.
  console.error('[dev-ide] falha ao iniciar:', mensagem);
  dialog.showErrorBox('A dev-ide não subiu', mensagem);
  app.quit();
});

// No Linux e no Windows, fechar a janela fecha o aplicativo — é o que se espera
// de um editor. No macOS o costume é o contrário, e o costume de lá manda.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
