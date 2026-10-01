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
const crypto = require('crypto');

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
    // Uma lista em que TUDO é undefined é o resto de um \`map\` que só
    // imprimia (\`ids.map(i => console.log(i))\`): não diz nada, e soterrava
    // as linhas que ele queria ver.
    const soUndefined = Array.isArray(valor) && valor.length > 0 && valor.every((x) => x === undefined);
    if (valor !== undefined && !soUndefined) mostrar(exec, valor);
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

// ---- A cascata entre linguagens (spec 113) ----
// O motor pede "o que mudou?" (exportar) e entrega o que outra linguagem mudou
// (importar). Só DADO passa: primitivos, arrays, objetos simples e datas. Um
// array de objetos viaja como tabela (colunas + linhas), que o Python abre como
// DataFrame. A impressão digital (sha1 do JSON) diz o que mudou — inclusive por
// dentro, como pedidos[0].total = 5, que não é reatribuição.
const TABELA = '__braytech_tabela__';
const impressoes = new Map();
let iniciais = new Set();
const NAO = new Error('nao serializavel');

function dado(v, ancestrais) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'bigint') return v.toString();
  if (t === 'function' || t === 'symbol') throw NAO;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (ancestrais.has(v)) throw NAO;
  ancestrais.add(v);
  try {
    if (Array.isArray(v)) return v.map((x) => dado(x, ancestrais));
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw NAO;
    const o = {};
    for (const k of Object.keys(v)) o[k] = dado(v[k], ancestrais);
    return o;
  } finally {
    ancestrais.delete(v);
  }
}

function ehObjetoSimples(x) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function exportavel(v) {
  if (Array.isArray(v) && v.length > 0 && v.every(ehObjetoSimples)) {
    const colunas = [];
    for (const x of v) for (const k of Object.keys(x)) if (!colunas.includes(k)) colunas.push(k);
    const linhas = v.map((x) => colunas.map((k) => dado(x[k], new Set())));
    return { [TABELA]: true, colunas, linhas };
  }
  return dado(v, new Set());
}

function serializado(nome) {
  const v = globalThis[nome];
  if (v === undefined || typeof v === 'function') return null;
  try { return JSON.stringify(exportavel(v)); } catch { return null; }
}

const impressao = (s) => crypto.createHash('sha1').update(s).digest('hex');
function lembrar(nome) {
  const s = serializado(nome);
  if (s !== null) impressoes.set(nome, impressao(s));
}

function exportar(p) {
  const partes = [];
  for (const nome of Object.getOwnPropertyNames(globalThis)) {
    if (iniciais.has(nome) || nome.startsWith('_')) continue;
    const s = serializado(nome);
    if (s === null) continue;
    const h = impressao(s);
    if (impressoes.get(nome) === h) continue;
    impressoes.set(nome, h);
    partes.push(JSON.stringify(nome) + ':' + s);
  }
  // Montado à mão: o valor já é JSON, e serializar de novo dobraria o custo.
  process.stdout.write(MARCA + '{"tipo":"exportado","pedido":' + Number(p.pedido) + ',"valores":{' + partes.join(',') + '}}\n');
}

function deTabela(v) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && v[TABELA] === true) {
    return v.linhas.map((l) => Object.fromEntries(v.colunas.map((c, i) => [c, l[i]])));
  }
  return v;
}

function importar(p) {
  for (const [nome, v] of Object.entries(p.valores || {})) {
    globalThis[nome] = deTabela(v);
    lembrar(nome);
  }
  enviar({ tipo: 'importado', pedido: p.pedido });
}

// ---- sql() dentro do kernel (spec 114, C) ----
// O motor executa pela conexão do notebook e responde pelo canal. Cada sql()
// vale sozinho; tudo-ou-nada só com sql.transacao(async () => { ... }).
const esperandoSql = new Map();
let proximoSql = 1;
let transacaoAtual = null;

function pedirAoMotor(dados) {
  const pedido = proximoSql++;
  return new Promise((resolver, recusar) => {
    esperandoSql.set(pedido, (r) => (r.erro ? recusar(new Error(r.erro)) : resolver(r)));
    enviar(Object.assign({}, dados, { pedido }));
  });
}

globalThis.sql = async function sql(texto, params) {
  const r = await pedirAoMotor({ tipo: 'sql', texto: String(texto), params: params || [], transacao: transacaoAtual });
  if (r.colunas.length === 0) return { linhasAfetadas: r.linhasAfetadas };
  return r.linhas.map((l) => Object.fromEntries(r.colunas.map((c, i) => [c, l[i]])));
};

globalThis.sql.transacao = async function transacao(bloco) {
  // Dentro de outra: faz parte da mesma (não existe meia transação).
  if (transacaoAtual !== null) return await bloco();
  const { transacao: id } = await pedirAoMotor({ tipo: 'sql-transacao', acao: 'comecar' });
  transacaoAtual = id;
  try {
    const valor = await bloco();
    transacaoAtual = null;
    await pedirAoMotor({ tipo: 'sql-transacao', acao: 'confirmar', transacao: id });
    return valor;
  } catch (e) {
    transacaoAtual = null;
    await pedirAoMotor({ tipo: 'sql-transacao', acao: 'desfazer', transacao: id }).catch(() => undefined);
    throw e;
  }
};

let definindo = null;
function definir(p) {
  if (p.tipo === 'definir-inicio') definindo = { nome: p.nome, colunas: p.colunas, linhas: [] };
  else if (p.tipo === 'definir-lote' && definindo) for (const l of p.linhas) definindo.linhas.push(l);
  else if (p.tipo === 'definir-fim' && definindo) {
    const d = definindo;
    definindo = null;
    globalThis[d.nome] = d.linhas.map((l) => Object.fromEntries(d.colunas.map((c, i) => [c, l[i]])));
    // Chegou igual em todas as linguagens: não é "mudança" a exportar.
    lembrar(d.nome);
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
    else if (p.tipo === 'exportar') exportar(p);
    else if (p.tipo === 'importar') importar(p);
  }
  processando = false;
}

readline.createInterface({ input: process.stdin }).on('line', (linha) => {
  let p;
  try { p = JSON.parse(linha); } catch { return; }
  if (p.tipo === 'interromper') { interromper(); return; }
  // A resposta de um sql(): a célula está ESPERANDO por ela, então não entra
  // na fila (que só anda quando a célula termina).
  if (p.tipo === 'sql-resposta') {
    const resolver = esperandoSql.get(p.pedido);
    esperandoSql.delete(p.pedido);
    if (resolver) resolver(p);
    return;
  }
  fila.push(p);
  void drenar();
}).on('close', () => process.exit(0));

// O que já existe antes da primeira célula não é do usuário.
iniciais = new Set(Object.getOwnPropertyNames(globalThis));
enviar({ tipo: 'pronto', versao: process.version, executavel: process.execPath, pandas: false });
`;
