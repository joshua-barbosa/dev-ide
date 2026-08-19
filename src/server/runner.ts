import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ts from 'typescript';
import type { RegistroDeExecucoes } from './execucoes';

export type RunMode = 'file' | 'block' | 'function';
export type RunLanguage = 'javascript' | 'typescript' | 'php' | 'c' | 'csharp';

export interface RunRequest {
  mode: RunMode;
  /** Caminho do arquivo (obrigatório para 'file' e 'function'). */
  filePath?: string;
  /** Código selecionado (obrigatório para 'block'). */
  code?: string;
  /** Nome da função a invocar (obrigatório para 'function'). */
  functionName?: string;
  /** Argumentos da função, como array JSON. */
  args?: unknown[];
  /** Linguagem explícita; caso contrário é inferida pela extensão. */
  language?: string;
  /**
   * Identificador desta execução, para poder pará-la.
   *
   * Vem do CLIENTE de propósito: a resposta de `/api/run` só chega no fim, e um
   * id gerado aqui não daria como parar antes disso.
   */
  runId?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  /**
   * Encerrado pelo usuário.
   *
   * Separado de `timedOut` porque os dois viram `exitCode: null` (morte por
   * sinal) e seriam indistinguíveis na tela.
   */
  cancelled: boolean;
}

const RUN_TIMEOUT_MS = 15_000;
const COMPILE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

const EXT_LANG: Record<string, RunLanguage> = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.php': 'php',
  '.c': 'c', '.h': 'c',
  '.cs': 'csharp',
};

export async function runCode(
  req: RunRequest,
  registro?: RegistroDeExecucoes
): Promise<RunResult> {
  const lang = resolveLanguage(req);
  const { source, cwd } = buildSource(req, lang);

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-run-'));
  const controle: Controle | undefined =
    req.runId === undefined || registro === undefined
      ? undefined
      : { registro, id: req.runId };
  try {
    return await execute(lang, source, cwd, runDir, controle);
  } finally {
    // Sai do registro aconteça o que acontecer: id que sobrevive à execução
    // mataria a próxima.
    if (controle !== undefined) controle.registro.concluir(controle.id);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

/** O par que permite parar: onde registrar e sob que nome. */
interface Controle {
  readonly registro: RegistroDeExecucoes;
  readonly id: string;
}

function resolveLanguage(req: RunRequest): RunLanguage {
  const explicit = req.language as RunLanguage | undefined;
  if (explicit && ['javascript', 'typescript', 'php', 'c', 'csharp'].includes(explicit)) {
    return explicit;
  }
  const ext = req.filePath ? path.extname(req.filePath).toLowerCase() : '';
  return EXT_LANG[ext] ?? 'javascript';
}

// ---- Montagem do código-fonte por modo/linguagem ----

function buildSource(req: RunRequest, lang: RunLanguage): { source: string; cwd: string } {
  if (req.mode === 'block') {
    if (!req.code || !req.code.trim()) throw new Error('Nenhum código selecionado para executar.');
    const cwd = req.filePath ? path.dirname(req.filePath) : process.cwd();
    return { source: wrapBlock(req.code, lang), cwd };
  }

  if (!req.filePath) throw new Error('Caminho do arquivo é obrigatório para este modo de execução.');
  if (!fs.existsSync(req.filePath)) throw new Error(`Arquivo não encontrado: ${req.filePath}`);
  const fileSource = fs.readFileSync(req.filePath, 'utf8');
  const cwd = path.dirname(req.filePath);

  if (req.mode === 'file') {
    return { source: fileSource, cwd };
  }

  // mode === 'function'
  if (!req.functionName || !/^[A-Za-z_$][\w$.]*$/.test(req.functionName)) {
    throw new Error('Nome de função inválido.');
  }
  if (lang === 'c' || lang === 'csharp') {
    throw new Error(
      `Execução de função individual não é suportada para ${lang === 'c' ? 'C' : 'C#'} — ` +
        'execute o arquivo inteiro ou um bloco selecionado.'
    );
  }
  const invocation =
    lang === 'php'
      ? phpInvocation(fileSource, req.functionName, req.args ?? [])
      : jsInvocation(req.functionName, req.args ?? []);
  return { source: fileSource + invocation, cwd };
}

function wrapBlock(code: string, lang: RunLanguage): string {
  if (lang === 'php' && !code.trimStart().startsWith('<?')) {
    return '<?php\n' + code;
  }
  if (lang === 'c' && !/\bmain\s*\(/.test(code)) {
    return [
      '#include <stdio.h>',
      '#include <stdlib.h>',
      '#include <string.h>',
      '#include <math.h>',
      'int main(void) {',
      code,
      'return 0;',
      '}',
    ].join('\n');
  }
  return code; // js/ts/c# (top-level statements) rodam como estão
}

function jsInvocation(functionName: string, args: unknown[]): string {
  const argsJson = JSON.stringify(args);
  return `
;(async () => {
  try {
    const __fn = (${functionName});
    if (typeof __fn !== 'function') {
      console.error('"${functionName}" não é uma função neste arquivo.');
      process.exit(1);
    }
    const __result = await __fn(...${argsJson});
    if (__result !== undefined) {
      console.log('[retorno]', require('util').inspect(__result, { depth: 6, colors: false }));
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
`;
}

function phpInvocation(fileSource: string, functionName: string, args: unknown[]): string {
  // args em base64 para não depender de escaping dentro da string PHP
  const argsB64 = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  // Se o arquivo fechou o modo PHP com "?>", reabre; senão continua no mesmo bloco
  const prefix = fileSource.trimEnd().endsWith('?>') ? '\n<?php\n' : '\n;\n';
  return (
    prefix +
    `if (!function_exists('${functionName}')) { fwrite(STDERR, '"${functionName}" não é uma função neste arquivo.' . PHP_EOL); exit(1); }\n` +
    `$__args = json_decode(base64_decode('${argsB64}'), true);\n` +
    `$__result = call_user_func_array('${functionName}', $__args);\n` +
    `if ($__result !== null) { echo '[retorno] '; var_export($__result); echo PHP_EOL; }\n`
  );
}

// ---- Execução por linguagem ----

async function execute(
  lang: RunLanguage,
  source: string,
  cwd: string,
  runDir: string,
  controle?: Controle
): Promise<RunResult> {
  switch (lang) {
    case 'typescript':
    case 'javascript': {
      const js = lang === 'typescript' ? transpile(source) : source;
      const file = path.join(runDir, 'main.cjs');
      fs.writeFileSync(file, js, 'utf8');
      return execProcess(process.execPath, [file], cwd, RUN_TIMEOUT_MS, { controle });
    }
    case 'php': {
      const file = path.join(runDir, 'main.php');
      fs.writeFileSync(file, source, 'utf8');
      return execProcess('php', [file], cwd, RUN_TIMEOUT_MS, { controle });
    }
    case 'c': {
      const src = path.join(runDir, 'main.c');
      const bin = path.join(runDir, 'main.out');
      fs.writeFileSync(src, source, 'utf8');
      // A compilação entra sob o MESMO id: parar durante o `gcc` e parar durante o
      // programa são o mesmo botão para quem clica.
      const compile = await execProcess('gcc', [src, '-o', bin, '-lm'], runDir, COMPILE_TIMEOUT_MS, { controle });
      if (compile.exitCode !== 0) {
        return { ...compile, stderr: '[compilação]\n' + compile.stderr };
      }
      if (compile.cancelled) return compile;
      return execProcess(bin, [], cwd, RUN_TIMEOUT_MS, { controle });
    }
    case 'csharp': {
      // .NET 10+ executa arquivos .cs diretamente com "dotnet run <arquivo>"
      const file = path.join(runDir, 'main.cs');
      fs.writeFileSync(file, source, 'utf8');
      return execProcess('dotnet', ['run', file], runDir, COMPILE_TIMEOUT_MS, {
        controle,
        missingHint:
          'Runtime "dotnet" não encontrado. Instale o .NET SDK 10+ para executar C# ' +
          '(https://dotnet.microsoft.com/download).',
      });
    }
  }
}

function transpile(source: string): string {
  const out = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  return out.outputText;
}

function execProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  options?: { missingHint?: string; controle?: Controle }
): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;

    // `detached` cria um GRUPO de processos próprio, e é o que permite matar os
    // filhos junto. Conserta um defeito que já existia no caminho do tempo
    // esgotado: `dotnet run` e `gcc` lançam subprocessos, e `child.kill()`
    // atingia só o pai — a IDE anunciava "tempo esgotado" com o neto vivo,
    // segurando CPU.
    const child = spawn(command, args, { cwd, env: process.env, detached: true });

    const encerrar = (): void => {
      try {
        // O sinal para `-pid` vai ao grupo inteiro. Entre decidir matar e
        // matar, o processo pode ter terminado — daí o `catch` para `ESRCH`.
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };

    // Direto no SIGKILL: um botão "parar" tem que parar. Cortesia de
    // encerramento faz sentido para servidor, não para script abandonado.
    options?.controle?.registro.registrar(options.controle.id, () => {
      cancelled = true;
      encerrar();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      encerrar();
    }, timeoutMs);

    const append = (current: string, chunk: Buffer): string =>
      current.length < MAX_OUTPUT_BYTES ? current + chunk.toString('utf8') : current;

    child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)));
    child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)));
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      // O parcial vai junto: a saída até o cancelamento costuma ser exatamente
      // o que se queria ver antes de desistir.
      resolve({ stdout, stderr, exitCode, durationMs: Date.now() - start, timedOut, cancelled });
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const message =
        err.code === 'ENOENT'
          ? options?.missingHint ??
            `Runtime "${command}" não encontrado nesta máquina. Instale-o para executar este tipo de arquivo.`
          : String(err);
      resolve({
        stdout,
        stderr: stderr + message,
        exitCode: 1,
        durationMs: Date.now() - start,
        timedOut,
        cancelled,
      });
    });
  });
}
