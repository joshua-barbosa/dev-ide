// Os kernels JS/TS e PHP, com Node e PHP de verdade (spec 112, etapa 3).
//
// O que se prova é o mesmo do Python: estado entre células, rodar de novo,
// Parar sem perder variáveis, SQL virando variável — e o ambiente do PROJETO:
// o `node_modules` e o `vendor` da pasta do notebook.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { iniciarKernelJs, iniciarKernelPhp } from '../notebook/kernel-python';
import { prepararCelulaJs } from '../notebook/celula-js';
import type { Execucao, Kernel } from '../notebook/kernel';
import { plataformaAtual } from '../../shared/plataforma';

const kernels: Kernel[] = [];
after(() => kernels.forEach((k) => k.encerrar()));

async function ate(e: Execucao, prazoMs = 10_000): Promise<Execucao> {
  const inicio = Date.now();
  while (!e.terminou) {
    if (Date.now() - inicio > prazoMs) throw new Error('a célula não terminou');
    await new Promise((r) => setTimeout(r, 20));
  }
  return e;
}

const textoDe = (e: Execucao): string =>
  e.saidas.map((s) => (s.tipo === 'texto' ? s.texto : s.tipo === 'erro' ? s.mensagem : '')).join('');

/** Uma pasta de projeto com um pacote em node_modules e uma classe no vendor. */
function projeto(): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-nb-proj-'));
  fs.mkdirSync(path.join(raiz, 'node_modules', 'saudacao'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'node_modules', 'saudacao', 'index.js'), "module.exports = (n) => 'olá, ' + n;");
  fs.mkdirSync(path.join(raiz, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'vendor', 'autoload.php'),
    "<?php spl_autoload_register(function ($c) { if ($c === 'App\\\\Calculadora') { eval('namespace App; class Calculadora { public static function dobro($n) { return $n * 2; } }'); } });");
  fs.mkdirSync(path.join(raiz, 'notas'));
  return raiz;
}

// ---- JS/TS ----

async function js(pasta: string): Promise<(codigo: string, ts?: boolean) => Execucao> {
  const k = await iniciarKernelJs(pasta, plataformaAtual());
  kernels.push(k);
  return (codigo, ehTs = false) => k.executar(prepararCelulaJs(codigo, ehTs ? 'typescript' : 'javascript'));
}

test('JS: estado entre células, e a MESMA célula rodada de novo', async () => {
  const rodar = await js(os.tmpdir());
  await ate(rodar('const itens = [1, 2, 3]'));
  await ate(rodar('const itens = [1, 2, 3, 4]'));
  assert.equal(textoDe(await ate(rodar('itens.length'))), '4\n');
});

test('JS: o require acha o node_modules do PROJETO', async () => {
  const raiz = projeto();
  const rodar = await js(path.join(raiz, 'notas'));
  await ate(rodar("import saudar from 'saudacao'"));
  assert.equal(textoDe(await ate(rodar("saudar('Ana')"))), "'olá, Ana'\n");
});

test('JS: console.log, console.error e erro com a linha da célula', async () => {
  const rodar = await js(os.tmpdir());
  const e = await ate(rodar('console.log("oi")\nconsole.error("ops")\nnull.x'));
  assert.ok(textoDe(e).includes('oi'));
  assert.ok(e.saidas.some((s) => s.tipo === 'texto' && s.fluxo === 'erro' && s.texto.includes('ops')));
  assert.ok(textoDe(e).includes('TypeError'));
});

test('JS: array de objetos vira tabela; TypeScript roda', async () => {
  const rodar = await js(os.tmpdir());
  const e = await ate(rodar('type L = { a: number }\nconst l: L[] = [{ a: 1 }, { a: 2 }]\nl', true));
  const t = e.saidas.find((s) => s.tipo === 'tabela');
  assert.ok(t !== undefined && t.tipo === 'tabela');
  assert.deepEqual(t.linhas, [[1], [2]]);
});

test('JS: Parar interrompe uma espera longa, e as variáveis ficam', async () => {
  const k = await iniciarKernelJs(os.tmpdir(), plataformaAtual());
  kernels.push(k);
  await ate(k.executar(prepararCelulaJs('const guardado = 42', 'javascript')));
  const lenta = k.executar(prepararCelulaJs('await new Promise((r) => setTimeout(r, 30000))', 'javascript'));
  await new Promise((r) => setTimeout(r, 300));
  k.interromper();
  await ate(lenta, 5_000);
  assert.ok(textoDe(lenta).includes('Interrompido'));
  assert.equal(textoDe(await ate(k.executar(prepararCelulaJs('guardado', 'javascript')))), '42\n');
});

test('JS: o resultado do SQL vira array de objetos', async () => {
  const k = await iniciarKernelJs(os.tmpdir(), plataformaAtual());
  kernels.push(k);
  const r = await k.definir('pedidos', ['cliente', 'total'], [['Ana', 50], ['Bia', 1500]]);
  assert.equal(r.forma, 'array');
  const e = await ate(k.executar(prepararCelulaJs('pedidos.filter((p) => p.total > 100).map((p) => p.cliente)', 'javascript')));
  assert.equal(textoDe(e), "[ 'Bia' ]\n");
});

// ---- PHP ----

async function php(pasta: string, autoload: string | null = null): Promise<Kernel> {
  const k = await iniciarKernelPhp('php', pasta, plataformaAtual(), autoload, null);
  kernels.push(k);
  return k;
}

test('PHP: a variável de uma célula existe na próxima, e a última expressão aparece', async () => {
  const k = await php(os.tmpdir());
  await ate(k.executar('$total = 21;'));
  assert.equal(textoDe(await ate(k.executar('$total * 2'))), '42\n');
});

test('PHP: echo, aviso e exceção com a linha', async () => {
  const k = await php(os.tmpdir());
  const e = await ate(k.executar('echo "oi\\n";\n$x = $naoExiste;\nthrow new Exception("ops");'));
  assert.ok(textoDe(e).includes('oi'));
  assert.ok(textoDe(e).includes('Undefined variable'));
  assert.ok(textoDe(e).includes('Exception: ops'));
});

test('PHP: erro de sintaxe não derruba o kernel', async () => {
  const k = await php(os.tmpdir());
  assert.ok(textoDe(await ate(k.executar('$a = ;'))).includes('ParseError'));
  assert.equal(textoDe(await ate(k.executar('1 + 1'))), '2\n');
});

test('PHP: ponto e vírgula dentro de texto não confunde a última expressão', async () => {
  const k = await php(os.tmpdir());
  assert.equal(textoDe(await ate(k.executar('$s = "x";\nstrtoupper("a;b")'))), "'A;B'\n");
});

test('PHP: classe do vendor do PROJETO', async () => {
  const raiz = projeto();
  const k = await php(path.join(raiz, 'notas'), path.join(raiz, 'vendor', 'autoload.php'));
  assert.equal(textoDe(await ate(k.executar('App\\Calculadora::dobro(21)'))), '42\n');
});

test('PHP: o resultado do SQL vira array e lista de arrays vira tabela', async () => {
  const k = await php(os.tmpdir());
  await k.definir('pedidos', ['cliente', 'total'], [['Ana', 50], ['Bia', 1500]]);
  const e = await ate(k.executar('array_values(array_filter($pedidos, fn($p) => $p["total"] > 100))'));
  const t = e.saidas.find((s) => s.tipo === 'tabela');
  assert.ok(t !== undefined && t.tipo === 'tabela');
  assert.deepEqual(t.colunas, ['cliente', 'total']);
  assert.deepEqual(t.linhas, [['Bia', 1500]]);
});

test('PHP: Parar interrompe (com pcntl), e as variáveis ficam', { skip: process.platform === 'win32' }, async () => {
  const k = await php(os.tmpdir());
  await ate(k.executar('$guardado = "ainda aqui";'));
  const lenta = k.executar('while (true) { usleep(100000); }');
  await new Promise((r) => setTimeout(r, 300));
  k.interromper();
  await ate(lenta, 5_000);
  assert.ok(textoDe(lenta).includes('Interrompido'), textoDe(lenta));
  assert.equal(textoDe(await ate(k.executar('$guardado'))), "'ainda aqui'\n");
});
