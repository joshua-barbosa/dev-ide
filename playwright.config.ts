// Configuração da suíte de ponta a ponta.
//
// A suíte sobe a PRÓPRIA IDE, com cofre e projetos num diretório temporário — o
// cofre real do usuário nunca é tocado. Ver e2e/global-setup.ts.
import { createServer } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Pede uma porta livre ao sistema. Fixar a porta faria a suíte colidir com a
 * IDE que o usuário deixou aberta — e a falha seria confusa.
 */
function portaLivre(): number {
  const servidor = createServer();
  servidor.listen(0);
  const { port } = servidor.address() as { port: number };
  servidor.close();
  return port;
}

const PORTA = process.env.E2E_PORT ?? String(portaLivre());
const DADOS = path.join(os.tmpdir(), `dev-ide-e2e-${PORTA}`);

// Repassados ao globalSetup e ao servidor, para os dois falarem do mesmo lugar.
process.env.E2E_PORT = PORTA;
process.env.E2E_DATA = DADOS;

export default defineConfig({
  testDir: './e2e',
  // A suíte compartilha uma instância da IDE, e trancar o cofre é estado global
  // do servidor: em paralelo, um teste derrubaria o outro de forma intermitente.
  // Falha intermitente mina a confiança na suíte inteira; lento não.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    // O Chrome já instalado, em vez do chromium do Playwright: evita casar a
    // versão do pacote com o build em cache, e não baixa nada.
    channel: 'chrome',
    headless: process.env.E2E_HEADED !== '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  webServer: {
    command: 'node dist/server/index.js',
    url: `http://127.0.0.1:${PORTA}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: PORTA,
      // Uma raiz só isola TUDO que a IDE grava — inclusive o que for
      // acrescentado depois. Antes eram variáveis por arquivo, e a
      // lembrança do cofre ficou de fora: a suíte apagava a do usuário.
      DEV_IDE_HOME: DADOS,
      DEV_IDE_PROJECTS: path.join(DADOS, 'projects'),
    },
  },
});
