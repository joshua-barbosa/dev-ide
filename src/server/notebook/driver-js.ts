// O programa que roda DENTRO do Node do notebook JS/TS (spec 112, etapa 3).
//
// Recebe JavaScript PRONTO: o motor já transformou a célula (`celula-js.ts`) —
// tipos fora, `import` virou `require`, cada célula na própria função
// assíncrona, nomes publicados em `globalThis`.
//
// O `require` resolve a partir da PASTA DO NOTEBOOK: é assim que o
// `node_modules` do projeto dele vale, que era o "kernel = de onde vêm os
// pacotes" que ele descreveu.
//
// Parar: `breakOnSigint` corta a parte síncrona; a espera assíncrona é
// abandonada (o que ela agendou ainda pode acontecer depois — o Node não tem
// como cancelar uma promessa alheia). No Windows não há sinal: o motor manda a
// mensagem, que só alcança a parte assíncrona, e a rede de segurança dele
// encerra o kernel se a célula não parar.
export const DRIVER_JS = String.raw`
'use strict';
const vm = require('vm');
const util = require('util');
const path = require('path');
const readline = require('readline');
const { Console } = require('console');
const { Writable } = require('stream');
const { createRequire } = require('module');

const MARCA = '\x1eBRNB\x1f';
const MAX_LINHAS = 500;
const MAX_TEXTO = 200000;
const pasta = process.argv[2] || process.cwd();

const serializar = (d) => JSON.stringify(d, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
function enviar(dados) {
  process.stdout.write(MARCA + serializar(dados) + '\n');
}

// O stderr da célula viaja NO canal: por outro cano ele chegaria depois do
// "fim" e sumiria (o mesmo defeito que o Python teve).
// Um Writable de verdade: o Console chama métodos de fluxo (removeListener…), e
// com um objeto qualquer o console.error virava erro e matava a célula.
const erroPeloCanal = new Writable({
  write(pedaco, _cod, pronto) {
    enviar({ tipo: 'texto', fluxo: 'erro', texto: pedaco.toString() });
    pronto();
  },
});
globalThis.console = new Console({ stdout: process.stdout, stderr: erroPeloCanal });
process.stderr.write = (t) => erroPeloCanal.write(t);

globalThis.require = createRequire(path.join(pasta, '__notebook__.js'));
globalThis.__dirname = pasta;
globalThis.__filename = path.join(pasta, '__notebook__.js');

let executando = false;
let interromperAgora = null;

function interromper() {
  if (executando && interromperAgora !== null) interromperAgora(new Error('Interrompido.'));
}
process.on('SIGINT', interromper);

function ehTabela(v) {
  return Array.isArray(v) && v.length > 0 &&
    v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x));
}

function mostrar(exec, valor) {
  let saida;
  if (ehTabela(valor)) {
    const colunas = [];
    for (const x of valor) for (const k of Object.keys(x)) if (!colunas.includes(k)) colunas.push(k);
    const linhas = valor.slice(0, MAX_LINHAS).map((x) => colunas.map((k) => (x[k] === undefined ? null : x[k])));
    saida = { tipo: 'tabela', colunas, linhas, total: valor.length };
  } else {
    let texto = util.inspect(valor, { depth: 4, maxArrayLength: 100, breakLength: 100 });
    if (texto.length > MAX_TEXTO) texto = texto.slice(0, MAX_TEXTO) + '\n… (cortado)';
    saida = { tipo: 'texto', fluxo: 'saida', texto: texto + '\n' };
  }
  enviar({ tipo: 'resultado', exec, saida });
}

// mostrarImagem(bytes, 'image/png'): JS não tem a convenção do Jupyter
// (_repr_png_), então a imagem se mostra por uma função.
globalThis.mostrarImagem = (dados, mime = 'image/png') => {
  const b64 = typeof dados === 'string' ? dados : Buffer.from(dados).toString('base64');
  if (executando) enviar({ tipo: 'resultado', exec: execucaoAtual, saida: { tipo: 'imagem', mime, dados: b64 } });
};
let execucaoAtual = null;

function descrever(e) {
  if (e instanceof Error || (e && typeof e.stack === 'string')) {
    const pilha = String(e.stack || '').split('\n');
    // Só as linhas da CÉLULA: as do driver e do Node são ruído.
    const daCelula = pilha.filter((l) => l.includes('<célula>'));
    return [pilha[0] || String(e), ...daCelula].join('\n');
  }
  return util.inspect(e);
}

async function executar(exec, codigo) {
  let ok = false;
  try {
    const script = new vm.Script(codigo, { filename: '<célula>' });
    executando = true;
    execucaoAtual = exec;
    const interrompida = new Promise((_, recusar) => { interromperAgora = recusar; });
    const valor = await Promise.race([script.runInThisContext({ breakOnSigint: true }), interrompida]);
    if (valor !== undefined) mostrar(exec, valor);
    ok = true;
  } catch (e) {
    const cortada = e && /Script execution was interrupted|^Interrompido/.test(String(e.message || ''));
    enviar({ tipo: 'erro', exec, mensagem: cortada ? 'Interrompido.' : descrever(e) });
  } finally {
    executando = false;
    interromperAgora = null;
    enviar({ tipo: 'fim', exec, ok });
  }
}

let definindo = null;
function definir(p) {
  if (p.tipo === 'definir-inicio') definindo = { nome: p.nome, colunas: p.colunas, linhas: [] };
  else if (p.tipo === 'definir-lote' && definindo) for (const l of p.linhas) definindo.linhas.push(l);
  else if (p.tipo === 'definir-fim' && definindo) {
    const d = definindo;
    definindo = null;
    globalThis[d.nome] = d.linhas.map((l) => Object.fromEntries(d.colunas.map((c, i) => [c, l[i]])));
    enviar({ tipo: 'definido', nome: d.nome, linhas: d.linhas.length, forma: 'array' });
  }
}

function comoParametro(v) {
  if (v instanceof Set) v = [...v];
  if (Array.isArray(v)) return v.map(comoParametro);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (v === undefined) return null;
  return v;
}

function obter(p) {
  const valores = {};
  const faltando = [];
  for (const nome of p.nomes || []) {
    if (!(nome in globalThis)) faltando.push(nome);
    else valores[nome] = comoParametro(globalThis[nome]);
  }
  enviar({ tipo: 'valores', pedido: p.pedido, valores, faltando, erros: {} });
}

const fila = [];
let processando = false;
async function drenar() {
  if (processando) return;
  processando = true;
  while (fila.length > 0) {
    const p = fila.shift();
    if (p.tipo === 'executar') await executar(p.exec, p.codigo || '');
    else if (String(p.tipo).startsWith('definir')) definir(p);
    else if (p.tipo === 'obter') obter(p);
  }
  processando = false;
}

readline.createInterface({ input: process.stdin }).on('line', (linha) => {
  let p;
  try { p = JSON.parse(linha); } catch { return; }
  if (p.tipo === 'interromper') { interromper(); return; }
  fila.push(p);
  void drenar();
}).on('close', () => process.exit(0));

enviar({ tipo: 'pronto', versao: process.version, executavel: process.execPath, pandas: false });
`;
