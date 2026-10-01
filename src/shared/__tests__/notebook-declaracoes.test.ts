// O que o editor de uma célula JS/TS sabe das variáveis do notebook.
//
// O relato (0.1.12): *"o autocompletion não funcionou no JS/TS, em fato,
// quando eu passei o patients, ele ficou em vermelho, como se não conhecesse a
// variavel"*. O `patients` vinha de uma célula SQL. O TypeScript do editor
// analisa a célula sozinha; estas declarações contam a ele o resto.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codigoDasOutrasCelulas, declaracoesDoNotebook, nomesDeclarados } from '../notebook/declaracoes';
import { alterarCelula, inserirCelula, notebookNovo, registrarExecucao, saidaDeTabela, type Notebook } from '../notebook/modelo';

function nbCom(): Notebook {
  let nb: Notebook = { ...notebookNovo('typescript', null), celulas: [] };
  nb = inserirCelula(nb, 'sql', 0, 's');
  nb = alterarCelula(nb, 's', { nome: 'patients' });
  nb = registrarExecucao(nb, 's', 1, [saidaDeTabela(['id', 'name', 'ativo', 'obs'], [[1, 'Ana', true, null], [2, 'Bia', false, 'x']])]);
  nb = inserirCelula(nb, 'codigo', 1, 'a');
  nb = alterarCelula(nb, 'a', { conteudo: 'const ids = patients.map((p) => p.id)\nfunction dobro(n: number) { return n * 2 }' });
  nb = inserirCelula(nb, 'codigo', 2, 'b');
  return nb;
}

test('o resultado do SQL vira um array tipado pelas colunas do último resultado', () => {
  const d = declaracoesDoNotebook(nbCom(), 'b');
  assert.match(d, /declare var patients: Array<\{ "id": number \| null; "name": string \| null; "ativo": boolean \| null; "obs": string \| null \}>;/);
});

test('SQL que ainda não rodou: array de registros, sem colunas conhecidas', () => {
  let nb = nbCom();
  nb = inserirCelula(nb, 'sql', 0, 's2');
  nb = alterarCelula(nb, 's2', { nome: 'pedidos' });
  assert.match(declaracoesDoNotebook(nb, 'b'), /declare var pedidos: Array<Record<string, any>>;/);
});

test('o CÓDIGO das outras células vai junto, para o TypeScript inferir o tipo', () => {
  // O relato: "criei um const users do patients e na celula seguida não
  // reconheceu o tipo do u". Com o código, users é o que o map devolve.
  const c = codigoDasOutrasCelulas(nbCom(), 'b');
  assert.match(c, /const ids = patients\.map\(\(p\) => p\.id\)/);
  assert.match(c, /function dobro/);
  // E nada de "declare var ids: any" competindo com ele.
  assert.doesNotMatch(declaracoesDoNotebook(nbCom(), 'b'), /declare var ids/);
});

test('a célula EM FOCO não entra no código das outras', () => {
  assert.doesNotMatch(codigoDasOutrasCelulas(nbCom(), 'a'), /const ids/);
  // Mas o patients do SQL, que ela só USA, continua declarado.
  assert.match(declaracoesDoNotebook(nbCom(), 'a'), /declare var patients/);
});

test('outra célula que declara o MESMO nome da em foco fica de fora (seria "redeclarar")', () => {
  let nb = nbCom();
  nb = alterarCelula(nb, 'b', { conteudo: 'const ids = [1]' });
  const c = codigoDasOutrasCelulas(nb, 'b');
  assert.doesNotMatch(c, /const ids/);
  // O que ELA declarava e não conflita (dobro) continua conhecido, como any.
  assert.match(declaracoesDoNotebook(nb, 'b'), /declare var dobro: any;/);
});

test('import e export viram declaração: o arquivo segue sendo script (global)', () => {
  let nb = nbCom();
  nb = alterarCelula(nb, 'a', { conteudo: "import dayjs from 'dayjs'\nexport const hoje = dayjs()" });
  const c = codigoDasOutrasCelulas(nb, 'b');
  assert.doesNotMatch(c, /^import /m);
  assert.doesNotMatch(c, /^export /m);
  assert.match(c, /declare var dayjs: any;/);
  assert.match(c, /const hoje = dayjs\(\)/);
});

test('células Python e PHP não entram (não são JS)', () => {
  let nb = nbCom();
  nb = inserirCelula(nb, 'codigo', 0, 'py');
  nb = alterarCelula(nb, 'py', { linguagem: 'python', conteudo: 'const_x = 1' });
  assert.doesNotMatch(declaracoesDoNotebook(nb, 'b'), /const_x/);
  assert.doesNotMatch(codigoDasOutrasCelulas(nb, 'b'), /const_x/);
});

test('o ambiente do kernel: require, process, mostrarImagem', () => {
  const d = declaracoesDoNotebook(nbCom(), 'b');
  assert.match(d, /declare var require: any;/);
  assert.match(d, /declare var process: any;/);
  assert.match(d, /declare function mostrarImagem\(/);
  assert.match(d, /declare const sql: /);
});

test('nomes declarados: const/let/var, desestruturação, function, class e import', () => {
  const codigo = [
    'const a = 1, b = 2',
    'let { c, d: e } = obj',
    'var [f, g] = lista',
    'async function h() {}',
    'class I {}',
    "import j from 'x'",
    "import * as k from 'y'",
    "import { l, m as n } from 'z'",
    '  const dentro = 1',
    'if (x) { const tambemDentro = 2 }',
  ].join('\n');
  assert.deepEqual(nomesDeclarados(codigo).sort(), ['I', 'a', 'b', 'c', 'e', 'f', 'g', 'h', 'j', 'k', 'l', 'n'].sort());
});

// ---- Com o compilador TypeScript de verdade ----
// O relato (0.1.16): o "users" de outra célula voltou a dar "Cannot find name
// 'users'. (2304)". O guarda do navegador passava porque o notebook dele era
// simples; aqui o notebook tem uma célula QUEBRADA (uma chave aberta, como no
// meio da digitação) antes da que declara users.
import ts from 'typescript';
import { arquivosDasOutrasCelulas } from '../notebook/declaracoes';

/** Os erros que o TypeScript daria na célula em foco, com os arquivos do notebook. */
function errosDaCelula(nb: Notebook, idEmFoco: string): string[] {
  const foco = nb.celulas.find((c) => c.id === idEmFoco)?.conteudo ?? '';
  const arquivos = new Map<string, string>([
    ['/foco.ts', foco],
    ['/notebook.d.ts', declaracoesDoNotebook(nb, idEmFoco)],
    ...arquivosDasOutrasCelulas(nb, idEmFoco).map((a) => [`/${a.nome}`, a.conteudo] as [string, string]),
  ]);
  const opcoes: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, noLib: true, strict: false };
  const host = ts.createCompilerHost(opcoes);
  host.getSourceFile = (nome, versao) =>
    arquivos.has(nome) ? ts.createSourceFile(nome, arquivos.get(nome) ?? '', versao) : undefined;
  host.fileExists = (nome) => arquivos.has(nome);
  host.readFile = (nome) => arquivos.get(nome);
  const programa = ts.createProgram([...arquivos.keys()], opcoes, host);
  return ts.getPreEmitDiagnostics(programa, programa.getSourceFile('/foco.ts'))
    .filter((d) => d.code === 2304 || d.code === 2451)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test('uma célula QUEBRADA não apaga o que as outras declaram', () => {
  let nb: Notebook = { ...notebookNovo('typescript', null), celulas: [] };
  nb = inserirCelula(nb, 'codigo', 0, 'quebrada');
  nb = alterarCelula(nb, 'quebrada', { conteudo: 'const rascunho = {' });
  nb = inserirCelula(nb, 'codigo', 1, 'u');
  nb = alterarCelula(nb, 'u', { conteudo: 'const users = [{ name: "a" }]' });
  nb = inserirCelula(nb, 'codigo', 2, 'm');
  nb = alterarCelula(nb, 'm', { conteudo: 'const messages = users.map((u) => u.name)' });
  assert.deepEqual(errosDaCelula(nb, 'm'), []);
});

test('a célula Python no meio não atrapalha', () => {
  let nb: Notebook = { ...notebookNovo('typescript', null), celulas: [] };
  nb = inserirCelula(nb, 'codigo', 0, 'u');
  nb = alterarCelula(nb, 'u', { conteudo: 'const users = [{ name: "a" }]' });
  nb = inserirCelula(nb, 'codigo', 1, 'py', 'python');
  nb = alterarCelula(nb, 'py', { conteudo: 'for u in users: print(u)' });
  nb = inserirCelula(nb, 'codigo', 2, 'm', 'typescript');
  nb = alterarCelula(nb, 'm', { conteudo: 'const messages = users.map((u) => u.name)' });
  assert.deepEqual(errosDaCelula(nb, 'm'), []);
});
