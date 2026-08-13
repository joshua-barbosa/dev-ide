import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCode } from '../runner';

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
