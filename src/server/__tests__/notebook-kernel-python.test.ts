// O kernel Python VIVO, com Python de verdade (spec 112, etapa 2).
//
// Precisa de `python3` no PATH (a máquina dele e o runner do GitHub têm). O que
// se prova aqui é o que faz "parecer Jupyter" virar "ser Jupyter": o estado
// sobrevive entre células, e Parar não o perde.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as os from 'node:os';
import { iniciarKernelPython } from '../notebook/kernel-python';
import type { Execucao, Kernel } from '../notebook/kernel';
import { plataformaAtual } from '../../shared/plataforma';

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const kernels: Kernel[] = [];
after(() => kernels.forEach((k) => k.encerrar()));

async function kernel(): Promise<Kernel> {
  const k = await iniciarKernelPython(PYTHON, os.tmpdir(), plataformaAtual());
  kernels.push(k);
  return k;
}

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

test('a variável de uma célula existe na próxima', async () => {
  const k = await kernel();
  await ate(k.executar('x = 2'));
  const e = await ate(k.executar('x * 21'));
  assert.equal(e.ok, true);
  assert.equal(textoDe(e), '42\n');
});

test('print, stderr e a última expressão aparecem', async () => {
  const k = await kernel();
  const e = await ate(k.executar('import sys\nprint("olá")\nprint("ops", file=sys.stderr)\n"fim"'));
  assert.ok(textoDe(e).includes('olá'));
  assert.ok(e.saidas.some((s) => s.tipo === 'texto' && s.fluxo === 'erro' && s.texto.includes('ops')));
  assert.ok(textoDe(e).includes("'fim'"));
});

test('erro mostra o traceback DA CÉLULA, sem as entranhas do driver', async () => {
  const k = await kernel();
  const e = await ate(k.executar('def f():\n    return 1 / 0\nf()'));
  assert.equal(e.ok, false);
  const t = textoDe(e);
  assert.ok(t.includes('ZeroDivisionError'), t);
  assert.ok(t.includes('<célula>'), t);
  assert.ok(!t.includes('braytech_kernel'), 'o driver não aparece');
});

test('erro de sintaxe vira erro, e o kernel segue vivo', async () => {
  const k = await kernel();
  const e = await ate(k.executar('def ('));
  assert.ok(textoDe(e).includes('SyntaxError'));
  assert.equal(textoDe(await ate(k.executar('1 + 1'))), '2\n');
});

test('Parar interrompe até um sleep, e as variáveis SOBREVIVEM', async () => {
  const k = await kernel();
  await ate(k.executar('guardado = "ainda aqui"'));
  const lenta = k.executar('import time\ntime.sleep(30)');
  await new Promise((r) => setTimeout(r, 400));
  const inicio = Date.now();
  k.interromper();
  await ate(lenta, 5_000);
  assert.ok(Date.now() - inicio < 3_000, 'parou na hora');
  assert.ok(textoDe(lenta).includes('Interrompido'));
  assert.equal(textoDe(await ate(k.executar('guardado'))), "'ainda aqui'\n");
});

test('o resultado do SQL vira variável — lista de dicionários sem pandas', async () => {
  const k = await kernel();
  const r = await k.definir('pedidos', ['id', 'cliente'], [[1, 'Ana'], [2, 'Bia']]);
  assert.equal(r.linhas, 2);
  const esperado = k.info.pandas ? 'DataFrame' : 'lista';
  assert.equal(r.forma, esperado);
  const e = await ate(k.executar(k.info.pandas ? 'pedidos["cliente"][1]' : 'pedidos[1]["cliente"]'));
  assert.equal(textoDe(e), "'Bia'\n");
});

test('resultado grande chega inteiro, em lotes', async () => {
  const k = await kernel();
  const linhas = Array.from({ length: 12_345 }, (_, i) => [i]);
  const r = await k.definir('muitos', ['n'], linhas);
  assert.equal(r.linhas, 12_345);
  assert.equal(textoDe(await ate(k.executar('len(muitos)'))), '12345\n');
});

test('lista de dicionários como última expressão vira TABELA', async () => {
  const k = await kernel();
  const e = await ate(k.executar('[{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]'));
  const t = e.saidas.find((s) => s.tipo === 'tabela');
  assert.ok(t !== undefined && t.tipo === 'tabela');
  assert.deepEqual(t.colunas, ['a', 'b']);
  assert.deepEqual(t.linhas, [[1, 'x'], [2, 'y']]);
});

test('input() é recusado com recado, e exit() não derruba o kernel', async () => {
  const k = await kernel();
  assert.ok(textoDe(await ate(k.executar('input("nome?")'))).includes('input() não funciona'));
  assert.ok(textoDe(await ate(k.executar('exit()'))).includes('exit() foi ignorado'));
  assert.equal(textoDe(await ate(k.executar('"vivo"'))), "'vivo'\n");
});

test('células na fila rodam em ordem', async () => {
  const k = await kernel();
  const a = k.executar('import time\ntime.sleep(0.3)\nprint("a")');
  const b = k.executar('print("b")');
  await ate(b);
  assert.equal(a.terminou, true, 'a primeira terminou antes');
  assert.equal(textoDe(a), 'a\n');
  assert.equal(textoDe(b), 'b\n');
});

test('interpretador que não existe dá recado claro', async () => {
  await assert.rejects(
    iniciarKernelPython('/nao/existe/python', os.tmpdir(), plataformaAtual()),
    /Não encontrei o programa/
  );
});

test('encerrar: a próxima célula diz que o kernel parou', async () => {
  const k = await kernel();
  k.encerrar();
  const e = k.executar('1');
  assert.equal(e.terminou, true);
  assert.ok(textoDe(e).includes('encerrado'));
});

test('célula que NÃO para em 3 s: o kernel é encerrado, e diz por quê', { skip: process.platform === 'win32' }, async () => {
  // A rede de segurança de quem não sabe ser interrompido (PHP no Windows, uma
  // chamada C). Aqui, uma célula que ignora o SIGINT de propósito.
  const k = await kernel();
  const teimosa = k.executar('import signal\nsignal.signal(signal.SIGINT, signal.SIG_IGN)\nwhile True: pass');
  await new Promise((r) => setTimeout(r, 400));
  k.interromper();
  await ate(teimosa, 6_000);
  assert.ok(textoDe(teimosa).includes('não parou em 3 s'), textoDe(teimosa));
  assert.equal(k.vivo, false);
});

test('quem sabe se desenhar (_repr_svg_) vira imagem; display() mostra no meio', async () => {
  const k = await kernel();
  const e = await ate(k.executar(
    'class Circulo:\n    def _repr_svg_(self):\n        return "<svg xmlns=\'http://www.w3.org/2000/svg\'><circle r=\'5\'/></svg>"\n' +
    'display("antes")\nCirculo()'
  ));
  assert.ok(textoDe(e).includes("'antes'"), 'display() mostrou no meio');
  const imagem = e.saidas.find((s) => s.tipo === 'imagem');
  assert.ok(imagem !== undefined && imagem.tipo === 'imagem');
  assert.equal(imagem.mime, 'image/svg+xml');
  assert.ok(Buffer.from(imagem.dados, 'base64').toString().includes('<circle'));
});
