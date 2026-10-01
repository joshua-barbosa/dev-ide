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
