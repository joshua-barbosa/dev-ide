// O formato `.brnb` do notebook (spec 112, etapa 1).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alterarCelula, escreverNotebook, inserirCelula, KERNELS, lerNotebook, limparSaidas,
  moverCelula, nomeDeResultadoLivre, nomeValido, notebookNovo, registrarExecucao,
  removerCelula, SAIDA_MAX_LINHAS, saidaDeTabela, type Notebook,
} from '../notebook/modelo';

const VINCULO = { connectionId: 'c1', database: 'loja' };

/** Um notebook só com as células pedidas (o `notebookNovo` já traz uma). */
function com(...tipos: ('codigo' | 'sql' | 'markdown')[]): Notebook {
  return tipos.reduce(
    (nb, tipo, i) => inserirCelula(nb, tipo, nb.celulas.length, `id${i}`),
    { ...notebookNovo('python', VINCULO), celulas: [] } as Notebook
  );
}

test('os quatro kernels da v1', () => {
  assert.deepEqual([...KERNELS], ['python', 'javascript', 'typescript', 'php']);
});

test('notebook novo nasce com uma célula de código vazia, pronto para escrever', () => {
  const nb = notebookNovo('php', null);
  assert.equal(nb.kernel, 'php');
  assert.equal(nb.conexao, null);
  assert.equal(nb.celulas.length, 1);
  assert.equal(nb.celulas[0].tipo, 'codigo');
});

test('grava e lê de volta SEM perder nada — saídas incluídas', () => {
  const base = com('sql', 'codigo', 'markdown');
  const rodado = registrarExecucao(base, 'id0', 3, [
    saidaDeTabela(['id', 'nome'], [[1, 'Ana']]),
    { tipo: 'texto', fluxo: 'saida', texto: 'ok\n' },
  ]);
  const lido = lerNotebook(escreverNotebook(rodado));
  assert.deepEqual(lido, rodado);
});

test('o arquivo diz o que é e em que versão', () => {
  const texto = escreverNotebook(notebookNovo('python', null));
  const json = JSON.parse(texto);
  assert.equal(json.formato, 'braytech-notebook');
  assert.equal(json.versao, 1);
  assert.ok(texto.endsWith('\n'), 'termina com quebra de linha, como todo arquivo de texto');
});

test('arquivo VAZIO não é erro: é um notebook que ainda não escolheu kernel', () => {
  // Criar `analise.brnb` pela árvore dá um arquivo vazio; a aba pergunta o kernel.
  assert.equal(lerNotebook(''), null);
  assert.equal(lerNotebook('  \n'), null);
});

test('arquivo estragado vira erro com recado, não tela branca', () => {
  assert.throws(() => lerNotebook('{ não é json'), /não é um notebook válido/i);
  assert.throws(() => lerNotebook('{"formato":"outra-coisa"}'), /não é um notebook/i);
  assert.throws(
    () => lerNotebook('{"formato":"braytech-notebook","versao":1,"kernel":"cobol","celulas":[]}'),
    /kernel "cobol"/i
  );
});

test('versão futura é recusada com recado, em vez de lida pela metade', () => {
  assert.throws(
    () => lerNotebook('{"formato":"braytech-notebook","versao":99,"kernel":"python","celulas":[]}'),
    /versão 99/i
  );
});

test('célula com campo estranho é lida pelo que se entende', () => {
  const texto = JSON.stringify({
    formato: 'braytech-notebook', versao: 1, kernel: 'python', conexao: null,
    celulas: [{ id: 'a', tipo: 'sql', conteudo: 'SELECT 1', saidas: [{ tipo: 'desconhecida' }], extra: 1 }],
  });
  const nb = lerNotebook(texto);
  assert.ok(nb !== null);
  assert.equal(nb.celulas[0].conteudo, 'SELECT 1');
  assert.deepEqual(nb.celulas[0].saidas, [], 'saída que não se entende é descartada');
  assert.equal(nb.celulas[0].nome, 'resultado1', 'SQL sem nome ganha um');
});

test('inserir, mexer e remover NÃO alteram o notebook original', () => {
  const nb = com('codigo');
  const mais = inserirCelula(nb, 'markdown', 0, 'novo');
  assert.equal(nb.celulas.length, 1);
  assert.deepEqual(mais.celulas.map((c) => c.id), ['novo', 'id0']);
  const mudado = alterarCelula(mais, 'novo', { conteudo: '# oi' });
  assert.equal(mais.celulas[0].conteudo, '');
  assert.equal(mudado.celulas[0].conteudo, '# oi');
  assert.deepEqual(removerCelula(mudado, 'novo').celulas.map((c) => c.id), ['id0']);
});

test('mudar o CONTEÚDO de uma célula não apaga a saída dela', () => {
  // Como no Jupyter: a saída é da última execução, até rodar de novo.
  const rodado = registrarExecucao(com('codigo'), 'id0', 1, [{ tipo: 'texto', fluxo: 'saida', texto: 'x' }]);
  const editado = alterarCelula(rodado, 'id0', { conteudo: 'print(2)' });
  assert.equal(editado.celulas[0].saidas.length, 1);
});

test('mover leva a célula para a posição pedida', () => {
  const nb = com('codigo', 'sql', 'markdown');
  assert.deepEqual(moverCelula(nb, 'id2', 0).celulas.map((c) => c.id), ['id2', 'id0', 'id1']);
  assert.deepEqual(moverCelula(nb, 'id0', 9).celulas.map((c) => c.id), ['id1', 'id2', 'id0']);
});

test('limpar saídas: todas, ou de uma célula só', () => {
  let nb = com('codigo', 'codigo');
  nb = registrarExecucao(nb, 'id0', 1, [{ tipo: 'texto', fluxo: 'saida', texto: 'a' }]);
  nb = registrarExecucao(nb, 'id1', 2, [{ tipo: 'texto', fluxo: 'saida', texto: 'b' }]);
  const uma = limparSaidas(nb, 'id0');
  assert.deepEqual(uma.celulas.map((c) => c.saidas.length), [0, 1]);
  const todas = limparSaidas(nb);
  assert.deepEqual(todas.celulas.map((c) => [c.saidas.length, c.contador]), [[0, null], [0, null]]);
});

test('a tabela GUARDADA no arquivo é a vista, não o dado inteiro', () => {
  // O kernel recebe tudo (sem teto, decisão dele); o ARQUIVO guarda o que se
  // vê — senão uma consulta grande viraria um .brnb de centenas de MB.
  const linhas = Array.from({ length: SAIDA_MAX_LINHAS + 10 }, (_, i) => [i]);
  const saida = saidaDeTabela(['n'], linhas);
  assert.equal(saida.tipo, 'tabela');
  if (saida.tipo !== 'tabela') return;
  assert.equal(saida.linhas.length, SAIDA_MAX_LINHAS);
  assert.equal(saida.total, SAIDA_MAX_LINHAS + 10);
});

test('nome de resultado: identificador que as três linguagens aceitam', () => {
  assert.equal(nomeValido('pedidos'), true);
  assert.equal(nomeValido('_x2'), true);
  assert.equal(nomeValido('2x'), false);
  assert.equal(nomeValido('meus pedidos'), false);
  assert.equal(nomeValido('pedidos-2026'), false);
  assert.equal(nomeValido(''), false);
});

test('o próximo nome livre não repete um que já existe', () => {
  let nb = com('sql', 'sql');
  assert.deepEqual(nb.celulas.map((c) => c.nome), ['resultado1', 'resultado2']);
  nb = alterarCelula(nb, 'id0', { nome: 'resultado3' });
  assert.equal(nomeDeResultadoLivre(nb), 'resultado1');
});
