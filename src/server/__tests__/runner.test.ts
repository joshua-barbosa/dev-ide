import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCode } from '../runner';
import { RegistroDeExecucoes } from '../execucoes';

function tempFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-runner-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('executa um bloco de código JavaScript', async () => {
  const result = await runCode({ mode: 'block', code: 'console.log(2 + 3)' });
  assert.equal(result.stdout.trim(), '5');
  assert.equal(result.exitCode, 0);
});

test('executa um bloco TypeScript com transpilação', async () => {
  const result = await runCode({
    mode: 'block',
    code: 'const x: number = 10; console.log(x * 2);',
    language: 'typescript',
  });
  assert.equal(result.stdout.trim(), '20');
  assert.equal(result.exitCode, 0);
});

test('executa um arquivo completo', async () => {
  const file = tempFile('main.js', 'console.log("arquivo executado")');
  const result = await runCode({ mode: 'file', filePath: file });
  assert.equal(result.stdout.trim(), 'arquivo executado');
});

test('executa uma função específica com argumentos e mostra o retorno', async () => {
  const file = tempFile('fns.ts', 'export function soma(a: number, b: number) { return a + b; }');
  const result = await runCode({ mode: 'function', filePath: file, functionName: 'soma', args: [4, 6] });
  assert.match(result.stdout, /\[retorno\] 10/);
  assert.equal(result.exitCode, 0);
});

test('reporta erro em código com exceção', async () => {
  const result = await runCode({ mode: 'block', code: 'throw new Error("boom")' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /boom/);
});

test('rejeita nome de função inválido', async () => {
  const file = tempFile('x.js', 'function f() {}');
  await assert.rejects(
    runCode({ mode: 'function', filePath: file, functionName: 'f(); rm -rf' }),
    /inválido/
  );
});

test('rejeita bloco vazio', async () => {
  await assert.rejects(runCode({ mode: 'block', code: '   ' }), /Nenhum código/);
});

// Os testes de PHP e C dependem de "php" e "gcc" instalados na máquina.

test('executa um bloco PHP sem tag de abertura', async () => {
  const result = await runCode({ mode: 'block', code: 'echo 2 + 3;', language: 'php' });
  assert.equal(result.stdout.trim(), '5');
  assert.equal(result.exitCode, 0);
});

test('executa um arquivo PHP completo', async () => {
  const file = tempFile('main.php', '<?php\necho strtoupper("olá php");\n');
  const result = await runCode({ mode: 'file', filePath: file });
  assert.match(result.stdout, /OLÁ PHP/i);
  assert.equal(result.exitCode, 0);
});

test('executa uma função PHP com argumentos e mostra o retorno', async () => {
  const file = tempFile('fns.php', '<?php\nfunction multiplicar($a, $b) { return $a * $b; }\n');
  const result = await runCode({
    mode: 'function',
    filePath: file,
    functionName: 'multiplicar',
    args: [6, 7],
  });
  assert.match(result.stdout, /\[retorno\] 42/);
  assert.equal(result.exitCode, 0);
});

test('executa um bloco C envolvendo-o em main()', async () => {
  const result = await runCode({
    mode: 'block',
    code: 'int x = 4;\nprintf("%d\\n", x * 10);',
    language: 'c',
  });
  assert.equal(result.stdout.trim(), '40');
  assert.equal(result.exitCode, 0);
});

test('executa um arquivo C completo com main()', async () => {
  const file = tempFile('main.c', '#include <stdio.h>\nint main(void) { printf("ola c\\n"); return 0; }\n');
  const result = await runCode({ mode: 'file', filePath: file });
  assert.equal(result.stdout.trim(), 'ola c');
  assert.equal(result.exitCode, 0);
});

test('reporta erro de compilação de C no stderr', async () => {
  const result = await runCode({ mode: 'block', code: 'isso nao compila;', language: 'c' });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /\[compilação\]/);
});

test('função individual não é suportada para C e C#', async () => {
  const cFile = tempFile('a.c', 'int f(void) { return 1; }');
  await assert.rejects(
    runCode({ mode: 'function', filePath: cFile, functionName: 'f' }),
    /não é suportada para C/
  );
  const csFile = tempFile('a.cs', 'int F() => 1;');
  await assert.rejects(
    runCode({ mode: 'function', filePath: csFile, functionName: 'F' }),
    /não é suportada para C#/
  );
});

// ---------------------------------------------------------------------------
// Parar a execução (spec 013)
// ---------------------------------------------------------------------------

/** Espera um arquivo aparecer. Determinístico, ao contrário de dormir um tanto. */
async function esperarArquivo(caminho: string, limiteMs = 5_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (fs.existsSync(caminho)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`O processo não chegou a criar ${caminho}.`);
}

test('parar encerra o processo e devolve o que já saiu', async () => {
  const registro = new RegistroDeExecucoes();
  const pronto = path.join(os.tmpdir(), `dev-ide-pronto-${process.pid}-${Date.now()}`);

  const promessa = runCode(
    {
      mode: 'block',
      language: 'javascript',
      // Escreve, avisa por arquivo e SÓ ENTÃO trava. O marcador existe porque
      // esperar "o registro ficar cheio" mata antes de o processo escrever —
      // o registro é preenchido no `spawn`, e o teste ficava vazio.
      code:
        'process.stdout.write("comecei\\n"); ' +
        `require("fs").writeFileSync(${JSON.stringify(pronto)}, "1"); ` +
        'while (true) {}',
      runId: 'teste-parar',
    },
    registro
  );

  await esperarArquivo(pronto);
  assert.equal(registro.parar('teste-parar'), true);

  const r = await promessa;
  assert.equal(r.cancelled, true);
  assert.equal(r.timedOut, false, 'cancelado não pode se confundir com tempo esgotado');
  assert.match(r.stdout, /comecei/, 'o parcial vem junto');
  fs.rmSync(pronto, { force: true });
});

test('o id sai do registro quando a execução termina sozinha', async () => {
  const registro = new RegistroDeExecucoes();
  await runCode(
    { mode: 'block', language: 'javascript', code: 'console.log(1);', runId: 'curta' },
    registro
  );
  assert.equal(registro.quantidade, 0);
  assert.equal(registro.parar('curta'), false);
});

test('execução normal não vem marcada como cancelada', async () => {
  const r = await runCode({ mode: 'block', language: 'javascript', code: 'console.log(1);' });
  assert.equal(r.cancelled, false);
});

test('parar mata os FILHOS também, não só o processo lançado', async () => {
  const registro = new RegistroDeExecucoes();
  const marcador = path.join(os.tmpdir(), `dev-ide-neto-${process.pid}-${Date.now()}`);

  // O pai lança um neto que grava um arquivo daqui a 3 segundos e sai. Se o
  // grupo morrer junto, o arquivo nunca aparece; se só o pai morrer, aparece.
  const lancou = `${marcador}.lancou`;
  const codigo = `
    const { spawn } = require('child_process');
    spawn(process.execPath, ['-e', 'setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marcador)}, "vivo"), 3000)'],
      { stdio: 'ignore' });
    require('fs').writeFileSync(${JSON.stringify(lancou)}, '1');
    while (true) {}
  `;

  const promessa = runCode(
    { mode: 'block', language: 'javascript', code: codigo, runId: 'com-neto' },
    registro
  );
  await esperarArquivo(lancou);
  registro.parar('com-neto');
  await promessa;

  await new Promise((r) => setTimeout(r, 4_000));
  assert.equal(
    fs.existsSync(marcador),
    false,
    'o neto sobreviveu: matar só o pai deixa órfão segurando CPU'
  );
  fs.rmSync(marcador, { force: true });
  fs.rmSync(lancou, { force: true });
});
