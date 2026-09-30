// Subir o kernel PYTHON do notebook (spec 112, etapa 2).
//
// O driver (`driver-python.ts`) vai para um arquivo temporário e roda com o
// interpretador escolhido — o `.venv` do projeto, quando há. Arquivo, e não
// `python -c`: o traceback aponta um nome de arquivo de verdade, e no Windows a
// linha de comando tem teto de tamanho.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DRIVER_PYTHON } from './driver-python';
import { Kernel } from './kernel';
import type { Plataforma } from '../../shared/plataforma';

export async function iniciarKernelPython(
  interpretador: string,
  pastaDoNotebook: string,
  plataforma: Plataforma
): Promise<Kernel> {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'braytech-kernel-'));
  const driver = path.join(pasta, 'braytech_kernel.py');
  fs.writeFileSync(driver, DRIVER_PYTHON, 'utf8');
  try {
    return await Kernel.iniciar({
      comando: interpretador,
      // `-u`: sem buffer — um `print` numa célula demorada aparece na hora.
      args: ['-u', driver],
      cwd: pastaDoNotebook,
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      plataforma,
    });
  } finally {
    // O Python já leu o arquivo ao subir; ele não precisa ficar no disco.
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}
