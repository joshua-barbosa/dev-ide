// Com que binário rodar JavaScript, e por que isso não é óbvio (T094).
//
// Defeito que ele encontrou usando o aplicativo empacotado, em 03/09/2026:
// mandar executar um arquivo derrubava tudo com
//
//   FATAL: The SUID sandbox helper binary was found, but is not configured
//   correctly... /empacotado/linux-unpacked/chrome-sandbox
//
// **A causa:** o executor chamava `process.execPath`. No modo navegador isso é o
// `node`, e está certo. **Dentro do Electron, `process.execPath` é o próprio
// aplicativo** — então executar um arquivo lançava uma SEGUNDA cópia do Braytech
// Code, que abortava na checagem de sandbox. A mensagem falava de sandbox, e o
// defeito era de execução de código.
//
// A saída não é procurar um `node` instalado: o Electron sabe virar Node puro
// quando `ELECTRON_RUN_AS_NODE` está no ambiente do filho. Assim o aplicativo
// empacotado executa JavaScript **sem exigir Node na máquina** — que é uma das
// razões de empacotar.

export interface AmbienteDeNode {
  readonly binario: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * O binário e o ambiente para rodar um `.cjs`.
 *
 * `versoesDoElectron` é `process.versions.electron`: presente só dentro do
 * Electron. É a checagem que o próprio Electron documenta, e não um palpite
 * sobre o caminho do executável.
 */
export function ambienteDeNode(
  execPath: string,
  versoesDoElectron: string | undefined,
  envAtual: Readonly<Record<string, string | undefined>> = {}
): AmbienteDeNode {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(envAtual)) {
    if (v !== undefined) env[k] = v;
  }

  if (versoesDoElectron === undefined) {
    // Modo navegador: `execPath` já é o `node` que subiu o servidor.
    delete env.ELECTRON_RUN_AS_NODE;
    return { binario: execPath, env };
  }

  return { binario: execPath, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
}
