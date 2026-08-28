import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inserir,
  alterar,
  blocosExecutaveis,
  comoRoda,
  escreverCaderno,
  lerCaderno,
  mover,
  remover,
  reordenar,
  VERSAO_DO_CADERNO,
  salvarResultado,
  removerResultado,
  MAX_LINHAS_SALVAS,
} from '../sql/caderno';

const doJson = (obj: unknown): string => JSON.stringify(obj);

// ---------------------------------------------------------------------------
// Ler e gravar
// ---------------------------------------------------------------------------

test('grava e lê de volta, preservando ordem e tipo', () => {
  const caderno = {
    celulas: [
      { id: 'c0', linguagem: 'markdown' as const, conteudo: '# Chamado 64158', resultados: [] },
      { id: 'c1', linguagem: 'sql' as const, conteudo: 'SELECT 1', resultados: [] },
    ],
  };
  const lido = lerCaderno(escreverCaderno(caderno));
  assert.deepEqual(
    lido.celulas.map((c) => [c.linguagem, c.conteudo]),
    [['markdown', '# Chamado 64158'], ['sql', 'SELECT 1']]
  );
});

test('o arquivo gravado declara a versão do formato', () => {
  const dados = JSON.parse(escreverCaderno({ celulas: [] })) as { versao: number };
  assert.equal(dados.versao, VERSAO_DO_CADERNO);
});

test('o id NÃO vai para o arquivo — ele é de tela, não de dado', () => {
  const texto = escreverCaderno({ celulas: [{ id: 'c0', linguagem: 'sql', conteudo: 'x', resultados: [] }] });
  assert.equal(texto.includes('"id"'), false);
});

test('SQL com qualquer coisa dentro sobrevive à ida e à volta', () => {
  // É a razão de o formato ser JSON: um caderno de SQL contém SQL arbitrário,
  // e qualquer separador escolhido poderia aparecer dentro de um bloco.
  const hostil = "SELECT '---', '```', '\\n-- celula', \"}\";";
  const lido = lerCaderno(escreverCaderno({ celulas: [{ id: 'c0', linguagem: 'sql', conteudo: hostil, resultados: [] }] }));
  assert.equal(lido.celulas[0]?.conteudo, hostil);
});

// ---------------------------------------------------------------------------
// Tolerância — arquivo do usuário nunca derruba a IDE
// ---------------------------------------------------------------------------

test('arquivo que não é JSON vira caderno vazio, sem lançar', () => {
  for (const lixo of ['', 'SELECT 1', '{', 'null', '[]', '"texto"']) {
    assert.deepEqual(lerCaderno(lixo).celulas, [], JSON.stringify(lixo));
  }
});

test('bloco estragado é descartado, e os vizinhos sobrevivem', () => {
  const texto = doJson({
    celulas: [
      { tipo: 'sql', conteudo: 'bom' },
      { tipo: 'inventado', conteudo: 'x' },
      { tipo: 'sql' },
      { conteudo: 'sem tipo' },
      null,
      { tipo: 'markdown', conteudo: 'também bom' },
    ],
  });
  assert.deepEqual(
    lerCaderno(texto).celulas.map((c) => c.conteudo),
    ['bom', 'também bom']
  );
});

test('ids repetidos no arquivo NÃO chegam repetidos ao caderno', () => {
  // Dois blocos com o mesmo id fariam o React confundir um com o outro.
  const texto = doJson({
    celulas: [
      { id: 'x', tipo: 'sql', conteudo: 'a' },
      { id: 'x', tipo: 'sql', conteudo: 'b' },
    ],
  });
  const ids = lerCaderno(texto).celulas.map((c) => c.id);
  assert.equal(new Set(ids).size, 2);
});

test('bloco vazio é preservado — vazio não é estragado', () => {
  const lido = lerCaderno(doJson({ celulas: [{ tipo: 'sql', conteudo: '' }] }));
  assert.equal(lido.celulas.length, 1);
});

// ---------------------------------------------------------------------------
// Mexer nos blocos
// ---------------------------------------------------------------------------

const tres = {
  celulas: [
    { id: 'a', linguagem: 'sql' as const, conteudo: '1', resultados: [] },
    { id: 'b', linguagem: 'sql' as const, conteudo: '2', resultados: [] },
    { id: 'c', linguagem: 'sql' as const, conteudo: '3', resultados: [] },
  ],
};

test('inserir conta FRESTAS: 0 é antes do primeiro, n é depois do último', () => {
  // A conta antiga era "depois de qual bloco", e a fresta 0 virava `-1` — que
  // ali queria dizer "no fim". Errava por um caderno inteiro (spec 050).
  assert.deepEqual(inserir(tres, 'sql', 0, 9).celulas.map((c) => c.id), ['c9', 'a', 'b', 'c']);
  assert.deepEqual(inserir(tres, 'sql', 3, 9).celulas.map((c) => c.id), ['a', 'b', 'c', 'c9']);
  assert.deepEqual(
    inserir(tres, 'markdown', 1, 9).celulas.map((c) => c.id),
    ['a', 'c9', 'b', 'c']
  );
});

test('inserir fora da faixa encosta na ponta mais próxima', () => {
  assert.deepEqual(inserir(tres, 'sql', -3, 9).celulas[0]?.id, 'c9');
  assert.deepEqual(inserir(tres, 'sql', 99, 9).celulas[3]?.id, 'c9');
});

test('alterar mexe só no bloco pedido', () => {
  const r = alterar(tres, 'b', 'novo');
  assert.deepEqual(r.celulas.map((c) => c.conteudo), ['1', 'novo', '3']);
});

test('remover tira só o pedido', () => {
  assert.deepEqual(remover(tres, 'b').celulas.map((c) => c.id), ['a', 'c']);
});

test('mover troca com o vizinho', () => {
  assert.deepEqual(mover(tres, 'b', -1).celulas.map((c) => c.id), ['b', 'a', 'c']);
  assert.deepEqual(mover(tres, 'b', 1).celulas.map((c) => c.id), ['a', 'c', 'b']);
});

test('mover nas pontas não faz nada, e NÃO embrulha', () => {
  // Embrulhar para o outro extremo seria uma surpresa desagradável.
  assert.deepEqual(mover(tres, 'a', -1).celulas.map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(mover(tres, 'c', 1).celulas.map((c) => c.id), ['a', 'b', 'c']);
});

test('mexer num id que não existe devolve o caderno como estava', () => {
  assert.deepEqual(mover(tres, 'zzz', 1), tres);
  assert.deepEqual(remover(tres, 'zzz').celulas.length, 3);
});

// ---------------------------------------------------------------------------
// O que o `Run All` roda
// ---------------------------------------------------------------------------

test('o Run All pula markdown e blocos vazios', () => {
  const misto = {
    celulas: [
      { id: 'a', linguagem: 'markdown' as const, conteudo: '# título', resultados: [] },
      { id: 'b', linguagem: 'sql' as const, conteudo: 'SELECT 1', resultados: [] },
      { id: 'c', linguagem: 'sql' as const, conteudo: '   ', resultados: [] },
      { id: 'd', linguagem: 'sql' as const, conteudo: 'SELECT 2', resultados: [] },
    ],
  };
  assert.deepEqual(blocosExecutaveis(misto).map((c) => c.id), ['b', 'd']);
});

test('o Run All mantém a ORDEM dos blocos', () => {
  // Um caderno é uma sequência: o bloco 5 costuma depender do 4.
  assert.deepEqual(blocosExecutaveis(tres).map((c) => c.conteudo), ['1', '2', '3']);
});

// ---------------------------------------------------------------------------
// Reordenar arrastando (spec 050)
// ---------------------------------------------------------------------------

const ids = (c: { celulas: readonly { id: string }[] }): string[] => c.celulas.map((x) => x.id);

test('arrastar para uma fresta adiante desconta a própria saída', () => {
  // A armadilha do arraste: ao tirar `a` da posição 0, tudo acima desce um.
  // A fresta 2 (entre `b` e `c`) tem que continuar sendo entre `b` e `c`.
  assert.deepEqual(ids(reordenar(tres, 'a', 2)), ['b', 'a', 'c']);
});

test('arrastar para o fim e para o começo', () => {
  assert.deepEqual(ids(reordenar(tres, 'a', 3)), ['b', 'c', 'a']);
  assert.deepEqual(ids(reordenar(tres, 'c', 0)), ['c', 'a', 'b']);
});

test('arrastar para uma fresta atrás NÃO desconta', () => {
  assert.deepEqual(ids(reordenar(tres, 'c', 1)), ['a', 'c', 'b']);
});

test('soltar na própria posição devolve o MESMO caderno', () => {
  // Idêntico, e não só igual: é o que impede o arquivo de ser marcado como
  // alterado por um arraste que não mudou nada (AC-11).
  assert.equal(reordenar(tres, 'b', 1), tres);
  assert.equal(reordenar(tres, 'b', 2), tres);
});

test('reordenar com id inexistente ou fresta fora da faixa não estraga nada', () => {
  assert.equal(reordenar(tres, 'zzz', 1), tres);
  assert.deepEqual(ids(reordenar(tres, 'a', 99)), ['b', 'c', 'a']);
  assert.deepEqual(ids(reordenar(tres, 'c', -5)), ['c', 'a', 'b']);
});

// ---------------------------------------------------------------------------
// Linguagem por bloco (spec 051)
// ---------------------------------------------------------------------------

test('o arquivo gravado traz `linguagem`, não `tipo`, na versão corrente', () => {
  const texto = escreverCaderno({ celulas: [{ id: 'c0', linguagem: 'php', conteudo: 'x', resultados: [] }] });
  const dados = JSON.parse(texto) as { versao: number; celulas: { linguagem: string }[] };
  // A versão sobe quando a forma muda (foi para 3 no T072); o que este teste
  // guarda é o NOME do campo, que é onde a versão 1 divergia.
  assert.equal(dados.versao, VERSAO_DO_CADERNO);
  assert.equal(dados.celulas[0]?.linguagem, 'php');
  assert.equal(texto.includes('"tipo"'), false);
});

test('caderno da VERSÃO 1 continua abrindo: `tipo` vira `linguagem`', () => {
  // Não é gentileza: os cadernos criados nos últimos dias estão em disco assim.
  const v1 = doJson({
    versao: 1,
    celulas: [
      { tipo: 'markdown', conteudo: '# título' },
      { tipo: 'sql', conteudo: 'SELECT 1' },
    ],
  });
  assert.deepEqual(
    lerCaderno(v1).celulas.map((c) => [c.linguagem, c.conteudo]),
    [['markdown', '# título'], ['sql', 'SELECT 1']]
  );
});

test('bloco sem `linguagem` NEM `tipo` é descartado, e os vizinhos ficam', () => {
  const texto = doJson({
    versao: 2,
    celulas: [
      { linguagem: 'sql', conteudo: 'bom' },
      { conteudo: 'órfão' },
      { linguagem: 'javascript', conteudo: 'também bom' },
    ],
  });
  assert.deepEqual(lerCaderno(texto).celulas.map((c) => c.conteudo), ['bom', 'também bom']);
});

test('qualquer linguagem é aceita no arquivo — quem julga é a tela', () => {
  // O formato não tem lista fechada: uma linguagem que a IDE não conhece vira
  // um bloco sem realce, e não um bloco perdido.
  const texto = doJson({ versao: 2, celulas: [{ linguagem: 'rust', conteudo: 'fn main() {}' }] });
  assert.equal(lerCaderno(texto).celulas[0]?.linguagem, 'rust');
});

test('comoRoda: cada linguagem tem UM destino', () => {
  assert.equal(comoRoda('sql'), 'sql');
  assert.equal(comoRoda('markdown'), 'markdown');
  for (const l of ['javascript', 'typescript', 'php', 'c', 'csharp']) {
    assert.equal(comoRoda(l), 'runner', l);
  }
  // Python está de fora de propósito: o runner é Node. Prometer e não cumprir é
  // pior que não oferecer.
  for (const l of ['python', 'json', 'yaml', 'html', 'rust', '']) {
    assert.equal(comoRoda(l), 'nada', l);
  }
});

test('o Run All roda só os blocos de SQL, e na ordem', () => {
  const misto = {
    celulas: [
      { id: 'a', linguagem: 'markdown', conteudo: '# título', resultados: [] },
      { id: 'b', linguagem: 'sql', conteudo: 'SELECT 1', resultados: [] },
      { id: 'c', linguagem: 'javascript', conteudo: 'console.log(1)', resultados: [] },
      { id: 'd', linguagem: 'sql', conteudo: '   ', resultados: [] },
      { id: 'e', linguagem: 'sql', conteudo: 'SELECT 2', resultados: [] },
    ],
  };
  assert.deepEqual(blocosExecutaveis(misto).map((c) => c.id), ['b', 'e']);
});

// ---------------------------------------------------------------------------
// Resultado guardado no bloco (T072, spec 071)
// ---------------------------------------------------------------------------

const RESULTADO = {
  nome: 'vendas de junho',
  salvoEm: '2026-08-28T12:00:00.000Z',
  colunas: ['id', 'total'],
  linhas: [['1', '10'], ['2', null]] as readonly (readonly (string | null)[])[],
  cortado: false,
};

test('o resultado salvo sobrevive à ida e volta do arquivo', () => {
  const caderno = { celulas: [{ id: 'c0', linguagem: 'sql', conteudo: 'SELECT 1', resultados: [] }] };
  const comResultado = salvarResultado(caderno, 'c0', RESULTADO);
  const lido = lerCaderno(escreverCaderno(comResultado));
  assert.deepEqual(lido.celulas[0]?.resultados, [RESULTADO]);
});

test('bloco SEM resultado não escreve o campo — o diff fica legível', () => {
  const texto = escreverCaderno({
    celulas: [{ id: 'c0', linguagem: 'sql', conteudo: 'x', resultados: [] }],
  });
  assert.equal(texto.includes('resultados'), false);
});

test('salvar com o MESMO nome substitui, e não acumula', () => {
  // Rodar de novo e salvar com o mesmo nome é ATUALIZAR aquele resultado.
  const caderno = { celulas: [{ id: 'c0', linguagem: 'sql', conteudo: 'x', resultados: [] }] };
  const um = salvarResultado(caderno, 'c0', RESULTADO);
  const dois = salvarResultado(um, 'c0', { ...RESULTADO, linhas: [['9', '99']] });
  assert.equal(dois.celulas[0]?.resultados.length, 1);
  assert.deepEqual(dois.celulas[0]?.resultados[0]?.linhas, [['9', '99']]);
});

test('resultado grande é CORTADO, e o corte é marcado', () => {
  // O caderno é um arquivo versionado: um JSON de megabytes por bloco tornaria
  // o diff ilegível, que é metade da razão de ele existir.
  const linhas = Array.from({ length: MAX_LINHAS_SALVAS + 50 }, (_, i) => [String(i)]);
  const caderno = { celulas: [{ id: 'c0', linguagem: 'sql', conteudo: 'x', resultados: [] }] };
  const salvo = salvarResultado(caderno, 'c0', { ...RESULTADO, colunas: ['i'], linhas });
  const r = salvo.celulas[0]?.resultados[0];
  assert.equal(r?.linhas.length, MAX_LINHAS_SALVAS);
  assert.equal(r?.cortado, true);
});

test('remover tira só aquele, e deixa os vizinhos', () => {
  const caderno = { celulas: [{ id: 'c0', linguagem: 'sql', conteudo: 'x', resultados: [] }] };
  const dois = salvarResultado(
    salvarResultado(caderno, 'c0', RESULTADO),
    'c0',
    { ...RESULTADO, nome: 'outro' }
  );
  const um = removerResultado(dois, 'c0', 'vendas de junho');
  assert.deepEqual(um.celulas[0]?.resultados.map((r) => r.nome), ['outro']);
});

test('resultado estragado no arquivo é descartado, e o bloco sobrevive', () => {
  const texto = JSON.stringify({
    versao: 3,
    celulas: [
      {
        linguagem: 'sql',
        conteudo: 'SELECT 1',
        resultados: [{ nome: '' }, { colunas: [] }, RESULTADO],
      },
    ],
  });
  const lido = lerCaderno(texto);
  assert.equal(lido.celulas.length, 1);
  assert.deepEqual(lido.celulas[0]?.resultados.map((r) => r.nome), ['vendas de junho']);
});

test('caderno da versão 2 abre sem resultados, e não quebra', () => {
  const texto = JSON.stringify({
    versao: 2,
    celulas: [{ linguagem: 'sql', conteudo: 'SELECT 1' }],
  });
  assert.deepEqual(lerCaderno(texto).celulas[0]?.resultados, []);
});
