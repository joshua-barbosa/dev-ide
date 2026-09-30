// Uma célula JS/TS preparada para o kernel (spec 112, etapa 3).
//
// O que não pode faltar: rodar a MESMA célula de novo (no Node, `const x`
// duas vezes é erro), os nomes de uma célula existirem na próxima, `await` no
// topo, e a última expressão aparecer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as vm from 'node:vm';
import { prepararCelulaJs } from '../notebook/celula-js';

/** Roda como o kernel roda: no mesmo contexto, esperando a promessa. */
function kernelDeTeste() {
  const contexto = vm.createContext({ require, console, setTimeout, Promise });
  return async (codigo: string, linguagem: 'javascript' | 'typescript' = 'javascript') =>
    vm.runInContext(prepararCelulaJs(codigo, linguagem), contexto, { filename: '<célula>' }) as Promise<unknown>;
}

test('a última expressão é o valor da célula', async () => {
  const rodar = kernelDeTeste();
  assert.equal(await rodar('const a = 2\na * 21'), 42);
});

test('o que uma célula declara existe na próxima', async () => {
  const rodar = kernelDeTeste();
  await rodar('const total = 10\nlet itens = [1, 2]\nfunction dobro(n) { return n * 2 }\nclass Caixa { x = 1 }');
  assert.equal(await rodar('dobro(total) + itens.length + new Caixa().x'), 23);
});

test('rodar a MESMA célula duas vezes não dá "already declared"', async () => {
  const rodar = kernelDeTeste();
  await rodar('const df = [1]');
  // O array nasce noutro contexto do `vm`: compara-se o CONTEÚDO.
  assert.deepEqual([...(await rodar('const df = [1, 2]\ndf')) as number[]], [1, 2]);
});

test('await no topo da célula', async () => {
  const rodar = kernelDeTeste();
  assert.equal(await rodar('const v = await Promise.resolve(7)\nv + 1'), 8);
});

test('desestruturação publica cada nome', async () => {
  const rodar = kernelDeTeste();
  await rodar('const { a, b: [c] } = { a: 1, b: [2] }');
  assert.equal(await rodar('a + c'), 3);
});

test('reatribuir uma variável de outra célula muda a de todos', async () => {
  const rodar = kernelDeTeste();
  await rodar('let contador = 1');
  await rodar('contador = contador + 1');
  assert.equal(await rodar('contador'), 2);
});

test('TypeScript: os tipos somem, o resto roda', async () => {
  const rodar = kernelDeTeste();
  assert.equal(await rodar('interface P { n: number }\nconst p: P = { n: 5 }\np.n * 2', 'typescript'), 10);
});

test('import vira require, e o nome fica para as próximas — em todas as formas', async () => {
  const rodar = kernelDeTeste();
  await rodar("import * as caminho from 'path'\nimport { join, sep as barra } from 'path'\nimport util from 'util'\nimport type { Stats } from 'fs'", 'typescript');
  const sep = require('node:path').sep;
  assert.equal(await rodar("caminho.join('a', 'b')"), `a${sep}b`);
  assert.equal(await rodar("join('c', 'd')"), `c${sep}d`);
  assert.equal(await rodar('barra'), sep);
  assert.equal(await rodar("typeof util.inspect"), 'function');
});

test('célula sem expressão no fim não tem valor', async () => {
  const rodar = kernelDeTeste();
  assert.equal(await rodar('const x = 1'), undefined);
});

test('erro de sintaxe continua sendo erro de sintaxe', async () => {
  const rodar = kernelDeTeste();
  // O erro nasce noutro contexto do `vm`: confere-se pelo NOME, não pelo protótipo.
  await assert.rejects(async () => rodar('const = 1'), (e: Error) => e.name === 'SyntaxError');
});
