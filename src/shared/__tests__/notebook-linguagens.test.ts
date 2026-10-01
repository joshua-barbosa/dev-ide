// Uma linguagem por CÉLULA de código (spec 113, etapa 1).
//
// O pedido: *"cada bloco ter seu próprio 'kernel', porque assim posso misturar
// linguagens diferentes em um mesmo notebook"*. O `kernel` do notebook vira a
// linguagem PADRÃO; cada célula de código diz a sua. Um `.brnb` da 0.1.12 tem
// de abrir igual.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alterarCelula, escreverNotebook, inserirCelula, lerNotebook, linguagemParaInserir,
  linguagensDoNotebook, notebookNovo, type Notebook,
} from '../notebook/modelo';
import { exportarIpynb } from '../notebook/ipynb';

const vazio = (kernel: Notebook['kernel']): Notebook => ({ ...notebookNovo(kernel, null), celulas: [] });

test('célula de código nova nasce na linguagem do notebook', () => {
  const nb = notebookNovo('javascript', null);
  assert.equal(nb.celulas[0].linguagem, 'javascript');
});

test('SQL e Markdown não têm linguagem de kernel', () => {
  const nb = inserirCelula(inserirCelula(vazio('python'), 'sql', 0, 's'), 'markdown', 1, 'm');
  assert.deepEqual(nb.celulas.map((c) => c.linguagem), [null, null]);
});

test('"+ adicionar" herda a linguagem da célula de código mais próxima ACIMA', () => {
  let nb = inserirCelula(vazio('python'), 'codigo', 0, 'a');
  nb = alterarCelula(nb, 'a', { linguagem: 'javascript' });
  nb = inserirCelula(nb, 'sql', 1, 's');
  // Abaixo do SQL: a de código acima dele é a JS.
  assert.equal(linguagemParaInserir(nb, 2), 'javascript');
  nb = inserirCelula(nb, 'codigo', 2, 'b');
  assert.equal(nb.celulas[2].linguagem, 'javascript');
  // No topo, sem nada acima: a do notebook.
  assert.equal(linguagemParaInserir(nb, 0), 'python');
});

test('trocar a linguagem de uma célula não mexe nas outras', () => {
  let nb = inserirCelula(inserirCelula(vazio('python'), 'codigo', 0, 'a'), 'codigo', 1, 'b');
  nb = alterarCelula(nb, 'b', { linguagem: 'php' });
  assert.deepEqual(nb.celulas.map((c) => c.linguagem), ['python', 'php']);
});

test('virar SQL apaga a linguagem; voltar a código usa a do notebook', () => {
  let nb = inserirCelula(vazio('typescript'), 'codigo', 0, 'a');
  nb = alterarCelula(nb, 'a', { linguagem: 'php' });
  nb = alterarCelula(nb, 'a', { tipo: 'sql' });
  assert.equal(nb.celulas[0].linguagem, null);
  nb = alterarCelula(nb, 'a', { tipo: 'codigo' });
  assert.equal(nb.celulas[0].linguagem, 'typescript');
});

test('as linguagens em uso, sem repetir, na ordem em que aparecem', () => {
  let nb = vazio('python');
  for (const [id, l] of [['a', 'javascript'], ['b', 'python'], ['c', 'javascript']] as const) {
    nb = inserirCelula(nb, 'codigo', nb.celulas.length, id);
    nb = alterarCelula(nb, id, { linguagem: l });
  }
  nb = inserirCelula(nb, 'sql', nb.celulas.length, 's');
  assert.deepEqual(linguagensDoNotebook(nb), ['javascript', 'python']);
});

test('grava e lê de volta com as linguagens', () => {
  let nb = inserirCelula(inserirCelula(vazio('python'), 'codigo', 0, 'a'), 'codigo', 1, 'b');
  nb = alterarCelula(nb, 'b', { linguagem: 'javascript' });
  assert.deepEqual(lerNotebook(escreverNotebook(nb)), nb);
});

test('um .brnb da 0.1.12 (sem linguagem na célula) abre com a do notebook', () => {
  const antigo = JSON.stringify({
    formato: 'braytech-notebook', versao: 1, kernel: 'php', conexao: null, laravel: false,
    celulas: [{ id: 'a', tipo: 'codigo', conteudo: 'echo 1;', nome: null, conexao: null, contador: null, saidas: [] }],
  });
  assert.equal(lerNotebook(antigo)?.celulas[0].linguagem, 'php');
});

test('notebook de UMA linguagem continua gravando versão 1 (a 0.1.12 abre)', () => {
  const nb = inserirCelula(vazio('python'), 'codigo', 0, 'a');
  assert.equal(JSON.parse(escreverNotebook(nb)).versao, 1);
});

test('notebook MISTO grava versão 2: uma versão velha recusa em vez de rodar JS no Python', () => {
  let nb = inserirCelula(vazio('python'), 'codigo', 0, 'a');
  nb = alterarCelula(nb, 'a', { linguagem: 'javascript' });
  assert.equal(JSON.parse(escreverNotebook(nb)).versao, 2);
});

test('linguagem desconhecida na célula cai na do notebook', () => {
  const lido = lerNotebook(JSON.stringify({
    formato: 'braytech-notebook', versao: 2, kernel: 'python', conexao: null, laravel: false,
    celulas: [{ id: 'a', tipo: 'codigo', linguagem: 'cobol', conteudo: '' }],
  }));
  assert.equal(lido?.celulas[0].linguagem, 'python');
});

test('.ipynb de notebook misto: Python vira código; as outras linguagens, Markdown com o código em bloco', () => {
  let nb = inserirCelula(inserirCelula(vazio('python'), 'codigo', 0, 'a'), 'codigo', 1, 'b');
  nb = alterarCelula(nb, 'a', { conteudo: 'x = 1' });
  nb = alterarCelula(nb, 'b', { linguagem: 'javascript', conteudo: 'const y = 2' });
  const ipynb = JSON.parse(exportarIpynb(nb, () => ''));
  assert.equal(ipynb.cells[0].cell_type, 'code');
  assert.equal(ipynb.cells[1].cell_type, 'markdown');
  assert.match(ipynb.cells[1].source.join(''), /```javascript\nconst y = 2\n```/);
});

test('.ipynb: um notebook sem nenhuma célula Python ainda recusa', () => {
  const nb = inserirCelula(vazio('javascript'), 'codigo', 0, 'a');
  assert.throws(() => exportarIpynb(nb, () => ''), /Python/);
});

test('"+ outra linguagem": inserir escolhendo a linguagem, não a herdada', () => {
  // O relato: "o adicionar bloco ainda está mostrando somente Javascript + SQL +
  // Markdown, apesar de ser multi linguagem agora".
  const nb = inserirCelula(vazio('javascript'), 'codigo', 0, 'a', 'python');
  assert.equal(nb.celulas[0].linguagem, 'python');
});
