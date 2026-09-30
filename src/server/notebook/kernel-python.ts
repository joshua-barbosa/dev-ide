// Subir os kernels do notebook, um por linguagem (spec 112, etapas 2 e 3).
//
// O driver de cada linguagem vai para um arquivo temporário e roda com o
// executável dela. Arquivo, e não `-c`/`-e`: o traceback aponta um nome de
// verdade, e no Windows a linha de comando tem teto de tamanho. Apagado logo
// que o processo sobe — ele já o leu.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DRIVER_PYTHON } from './driver-python';
import { DRIVER_JS } from './driver-js';
import { DRIVER_PHP } from './driver-php';
import { Kernel } from './kernel';
import { ambienteDeNode } from '../../shared/execucao-node';
import type { Plataforma } from '../../shared/plataforma';

async function comDriver(nome: string, conteudo: string, subir: (arquivo: string) => Promise<Kernel>) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-kernel-'));
  const arquivo = path.join(pasta, nome);
  fs.writeFileSync(arquivo, conteudo, 'utf8');
  try {
    return await subir(arquivo);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

/** No Windows não há sinal: vai a mensagem, e o prazo de parar faz o resto. */
const interrupcao = (plataforma: Plataforma) => (plataforma === 'win32' ? 'mensagem' : 'sinal');

export function iniciarKernelPython(
  interpretador: string,
  pastaDoNotebook: string,
  plataforma: Plataforma
): Promise<Kernel> {
  return comDriver('braytech_kernel.py', DRIVER_PYTHON, (driver) =>
    Kernel.iniciar({
      comando: interpretador,
      // `-u`: sem buffer — um `print` numa célula demorada aparece na hora.
      args: ['-u', driver],
      cwd: pastaDoNotebook,
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      plataforma,
      interromperPor: interrupcao(plataforma),
    })
  );
}

/**
 * JS/TS roda no MESMO Node do motor. Dentro do Electron (a IDE de desktop, o
 * host de extensões do Cursor), `process.execPath` é o próprio aplicativo — o
 * `ambienteDeNode` o faz se comportar como `node`, como o runner já faz.
 */
export function iniciarKernelJs(pastaDoNotebook: string, plataforma: Plataforma): Promise<Kernel> {
  const node = ambienteDeNode(process.execPath, process.versions.electron, process.env);
  return comDriver('braytech_kernel.cjs', DRIVER_JS, (driver) =>
    Kernel.iniciar({
      comando: node.binario,
      args: [driver, pastaDoNotebook],
      cwd: pastaDoNotebook,
      env: node.env,
      plataforma,
      interromperPor: interrupcao(plataforma),
    })
  );
}

export function iniciarKernelPhp(
  php: string,
  pastaDoNotebook: string,
  plataforma: Plataforma,
  autoload: string | null,
  laravel: string | null
): Promise<Kernel> {
  return comDriver('braytech_kernel.php', DRIVER_PHP, (driver) =>
    Kernel.iniciar({
      comando: php,
      args: [driver, autoload ?? '', laravel ?? ''],
      cwd: pastaDoNotebook,
      plataforma,
      // Com `pcntl` o SIGINT vira exceção na célula; sem ele (Windows), o prazo
      // de parar encerra o kernel.
      interromperPor: interrupcao(plataforma),
    })
  );
}
