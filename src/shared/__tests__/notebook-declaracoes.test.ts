// O que o editor de uma célula JS/TS sabe das variáveis do notebook.
//
// O relato (0.1.12): *"o autocompletion não funcionou no JS/TS, em fato,
// quando eu passei o patients, ele ficou em vermelho, como se não conhecesse a
// variavel"*. O `patients` vinha de uma célula SQL. O TypeScript do editor
// analisa a célula sozinha; estas declarações contam a ele o resto.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declaracoesDoNotebook, nomesDeclarados } from '../notebook/declaracoes';
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

test('o que as OUTRAS células de código declaram fica conhecido', () => {
  const d = declaracoesDoNotebook(nbCom(), 'b');
  assert.match(d, /declare var ids: any;/);
  assert.match(d, /declare var dobro: any;/);
});

test('o que a célula EM FOCO declara não entra (seria "redeclarar")', () => {
  const d = declaracoesDoNotebook(nbCom(), 'a');
  assert.doesNotMatch(d, /declare var ids/);
  assert.doesNotMatch(d, /declare var dobro/);
  // Mas o patients do SQL, que a célula só USA, continua.
  assert.match(d, /declare var patients/);
});

test('células Python e PHP não entram (não são JS)', () => {
  let nb = nbCom();
  nb = inserirCelula(nb, 'codigo', 0, 'py');
  nb = alterarCelula(nb, 'py', { linguagem: 'python', conteudo: 'const_x = 1' });
  assert.doesNotMatch(declaracoesDoNotebook(nb, 'b'), /const_x/);
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
