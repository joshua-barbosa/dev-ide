// Exportar o notebook para `.ipynb` (spec 112, etapa 5).
//
// Ele pediu na v1: *"Exportar para .ipynb"* — para abrir no Jupyter e o GitHub
// mostrar. Só notebook de kernel Python: o `.ipynb` declara UMA linguagem.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportarIpynb } from '../notebook/ipynb';
import { alterarCelula, inserirCelula, notebookNovo, registrarExecucao, saidaDeTabela, type Notebook } from '../notebook/modelo';

const rotulo = () => 'exemplo · loja';

function exemplo(): Notebook {
  let nb: Notebook = { ...notebookNovo('python', { connectionId: 'c1', database: 'loja' }), celulas: [] };
  nb = inserirCelula(nb, 'markdown', 0, 'md1');
  nb = alterarCelula(nb, 'md1', { conteudo: '# Vendas\nO trimestre.' });
  nb = inserirCelula(nb, 'sql', 1, 'sq1');
  nb = alterarCelula(nb, 'sq1', { conteudo: 'SELECT cliente, total\nFROM pedidos', nome: 'pedidos' });
  nb = registrarExecucao(nb, 'sq1', 1, [saidaDeTabela(['cliente', 'total'], [['Ana & <Bia>', 10]])]);
  nb = inserirCelula(nb, 'codigo', 2, 'py1');
  nb = alterarCelula(nb, 'py1', { conteudo: 'print("oi")\n2 + 2' });
  nb = registrarExecucao(nb, 'py1', 2, [
    { tipo: 'texto', fluxo: 'saida', texto: 'oi\n' },
    { tipo: 'texto', fluxo: 'saida', texto: '4\n' },
    { tipo: 'imagem', mime: 'image/png', dados: 'iVBORw0KGgo=' },
  ]);
  return nb;
}

test('o formato do Jupyter: nbformat 4.5, kernel Python', () => {
  const j = JSON.parse(exportarIpynb(exemplo(), rotulo));
  assert.equal(j.nbformat, 4);
  assert.equal(j.nbformat_minor, 5);
  assert.equal(j.metadata.kernelspec.language, 'python');
  assert.equal(j.cells.length, 3);
});

test('Markdown vira Markdown, com o texto em linhas', () => {
  const [md] = JSON.parse(exportarIpynb(exemplo(), rotulo)).cells;
  assert.equal(md.cell_type, 'markdown');
  assert.deepEqual(md.source, ['# Vendas\n', 'O trimestre.']);
});

test('código vira código, com contador, stdout e a imagem', () => {
  const py = JSON.parse(exportarIpynb(exemplo(), rotulo)).cells[2];
  assert.equal(py.cell_type, 'code');
  assert.equal(py.execution_count, 2);
  assert.deepEqual(py.outputs[0], { output_type: 'stream', name: 'stdout', text: ['oi\n', '4\n'] });
  assert.equal(py.outputs[1].output_type, 'display_data');
  assert.equal(py.outputs[1].data['image/png'], 'iVBORw0KGgo=');
});

test('SQL vira código com a consulta EM COMENTÁRIO e a tabela como saída', () => {
  const sql = JSON.parse(exportarIpynb(exemplo(), rotulo)).cells[1];
  assert.equal(sql.cell_type, 'code');
  const fonte = sql.source.join('');
  assert.match(fonte, /# SQL .*pedidos/);
  assert.match(fonte, /# conexão: exemplo · loja/);
  assert.match(fonte, /# SELECT cliente, total\n# FROM pedidos/);
  assert.ok(fonte.split('\n').every((l: string) => l === '' || l.startsWith('#')), 'rodar no Jupyter não faz nada');
  assert.equal(sql.metadata.braytech.nome, 'pedidos');
  const html = sql.outputs[0].data['text/html'].join('');
  assert.ok(html.includes('Ana &amp; &lt;Bia&gt;'), 'o HTML da tabela escapa o que vem do banco');
});

test('sem nenhuma célula Python, não exporta (spec 113: o misto exporta, ver notebook-linguagens)', () => {
  const nb = exemplo();
  const soPhp = {
    ...nb,
    kernel: 'php' as const,
    celulas: nb.celulas.map((c) => (c.tipo === 'codigo' ? { ...c, linguagem: 'php' as const } : c)),
  };
  assert.throws(() => exportarIpynb(soPhp, rotulo), /alguma célula Python/);
});

test('ids das células seguem a regra do nbformat', () => {
  const j = JSON.parse(exportarIpynb(exemplo(), rotulo));
  assert.ok(j.cells.every((c: { id: string }) => /^[a-zA-Z0-9-_]{1,64}$/.test(c.id)));
});
