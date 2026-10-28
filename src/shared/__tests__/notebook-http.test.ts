// A célula HTTP do notebook (spec 120, etapa 1): a parte pura.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aoEditarParams, aoEditarUrl, contentTypeDoRaw, interpolar, lerRequisicao, referenciasDaRequisicao,
  requisicaoVazia, resolverRequisicao, valorDaVariavel, type LinhaHttp, type RequisicaoHttp,
} from '../notebook/http';

const linha = (chave: string, valor: string, ligado = true): LinhaHttp => ({ ligado, chave, valor, descricao: '' });

test('requisição nova: GET, sem URL, sem corpo', () => {
  const r = requisicaoVazia();
  assert.equal(r.metodo, 'GET');
  assert.equal(r.url, '');
  assert.deepEqual(r.corpo, { tipo: 'nenhum' });
});

test('URL → Params: a query vira linhas, na ordem, sem decodificar', () => {
  const r = aoEditarUrl(requisicaoVazia(), 'https://api.exemplo.test/x?a=1&b=dois%20x&c');
  assert.deepEqual(r.params.map((p) => [p.chave, p.valor, p.ligado]), [
    ['a', '1', true], ['b', 'dois%20x', true], ['c', '', true],
  ]);
});

test('URL → Params: a linha DESLIGADA não está na URL e não some ao editar a URL', () => {
  const r = { ...requisicaoVazia(), url: 'http://h/x?a=1', params: [linha('a', '1'), linha('b', '2', false)] };
  const editada = aoEditarUrl(r, 'http://h/x?a=1&c=3');
  assert.deepEqual(editada.params.map((p) => [p.chave, p.ligado]), [['a', true], ['c', true], ['b', false]]);
});

test('URL → Params: a descrição de uma linha que continua na URL fica', () => {
  const r = { ...requisicaoVazia(), url: 'http://h/x?a=1', params: [{ ...linha('a', '1'), descricao: 'o id' }] };
  assert.equal(aoEditarUrl(r, 'http://h/x?a=2').params[0].descricao, 'o id');
});

test('Params → URL: só as ligadas, e a URL sem query perde o "?"', () => {
  const r = { ...requisicaoVazia(), url: 'http://h/x?velho=1' };
  assert.equal(aoEditarParams(r, [linha('a', '1'), linha('b', '2', false), linha('c', '{{id}}')]).url, 'http://h/x?a=1&c={{id}}');
  assert.equal(aoEditarParams(r, [linha('a', '1', false)]).url, 'http://h/x');
});

test('Params → URL: o fragmento (#) continua no fim', () => {
  const r = { ...requisicaoVazia(), url: 'http://h/x?a=1#topo' };
  assert.equal(aoEditarParams(r, [linha('b', '2')]).url, 'http://h/x?b=2#topo');
});

test('{{ }}: as variáveis de TODOS os campos, sem repetir', () => {
  const r: RequisicaoHttp = {
    ...requisicaoVazia(), metodo: 'POST',
    url: 'http://h/{{base}}/x?id={{pedido.id}}',
    params: [],
    headers: [linha('X-Token', '{{login.body.token}}'), linha('X-Off', '{{desligado}}', false)],
    corpo: { tipo: 'raw', formato: 'json', texto: '{"a": {{pedido}}, "b": "{{base}}"}' },
  };
  assert.deepEqual(referenciasDaRequisicao(r).sort(), ['base', 'login', 'pedido']);
});

test('{{ }}: nos campos de formulário e no caminho do binário também', () => {
  const r: RequisicaoHttp = {
    ...requisicaoVazia(),
    corpo: { tipo: 'form-data', campos: [{ ...linha('{{k}}', '{{v}}'), tipo: 'texto' }, { ...linha('f', '{{arq}}'), tipo: 'arquivo' }] },
  };
  assert.deepEqual(referenciasDaRequisicao(r).sort(), ['arq', 'k', 'v']);
  assert.deepEqual(referenciasDaRequisicao({ ...r, corpo: { tipo: 'binario', arquivo: '{{caminho}}' } }), ['caminho']);
});

test('interpolar: texto entra cru, número e booleano viram texto, objeto vira JSON', () => {
  const v = { nome: 'Ana', n: 3, ok: true, obj: { a: 1 }, nada: null };
  assert.equal(interpolar('{{nome}}-{{n}}-{{ok}}-{{obj}}-{{nada}}', v), 'Ana-3-true-{"a":1}-null');
});

test('interpolar: caminho com ponto e índice — {{login.body.token}}, {{lista[1].id}}', () => {
  const v = { login: { body: { token: 'abc' } }, lista: [{ id: 1 }, { id: 2 }] };
  assert.equal(interpolar('Bearer {{ login.body.token }}', v), 'Bearer abc');
  assert.equal(interpolar('{{lista[1].id}}', v), '2');
});

test('interpolar: campo que não existe é ERRO com o nome, não "undefined" calado', () => {
  assert.throws(() => interpolar('{{login.body.tokn}}', { login: { body: { token: 'x' } } }), /login\.body\.tokn/);
  assert.throws(() => interpolar('{{falta}}', {}), /falta/);
});

test('interpolar: texto sem {{ }} volta igual, e "{{ }}" que não é nome também', () => {
  assert.equal(interpolar('{"a": 1}', {}), '{"a": 1}');
  assert.equal(interpolar('{{ 1 + 1 }}', {}), '{{ 1 + 1 }}');
});

test('resolver: troca os {{ }} e DESCARTA linhas desligadas (não vão na requisição)', () => {
  const r: RequisicaoHttp = {
    ...requisicaoVazia(), metodo: 'GET', url: 'http://h/{{p}}', params: [],
    headers: [linha('A', '{{p}}'), linha('B', '{{naoexiste}}', false)],
    corpo: { tipo: 'urlencoded', campos: [linha('x', '{{p}}'), linha('y', '{{naoexiste}}', false)] },
  };
  const resolvida = resolverRequisicao(r, { p: 'v' });
  assert.equal(resolvida.url, 'http://h/v');
  assert.deepEqual(resolvida.headers.map((h) => [h.chave, h.valor]), [['A', 'v']]);
  assert.deepEqual(resolvida.corpo, { tipo: 'urlencoded', campos: [linha('x', 'v')] });
});

test('Content-Type do raw acompanha o formato', () => {
  assert.equal(contentTypeDoRaw('json'), 'application/json');
  assert.equal(contentTypeDoRaw('xml'), 'application/xml');
  assert.equal(contentTypeDoRaw('html'), 'text/html');
  assert.equal(contentTypeDoRaw('texto'), 'text/plain');
});

test('ler: o que veio do arquivo é conferido; lixo vira o padrão, não quebra', () => {
  assert.deepEqual(lerRequisicao(null), requisicaoVazia());
  const r = lerRequisicao({
    metodo: 'DELETE', url: 'http://h', params: [{ chave: 'a', valor: 1 }, 'lixo'],
    headers: [{ ligado: false, chave: 'H', valor: 'v', descricao: 'd' }],
    corpo: { tipo: 'raw', formato: 'yaml', texto: 'x' },
  });
  assert.equal(r.metodo, 'DELETE');
  assert.deepEqual(r.params, [linha('a', '1')]);
  assert.deepEqual(r.headers, [{ ligado: false, chave: 'H', valor: 'v', descricao: 'd' }]);
  // Formato que não existe: texto.
  assert.deepEqual(r.corpo, { tipo: 'raw', formato: 'texto', texto: 'x' });
  assert.equal(lerRequisicao({ metodo: 'XPTO' }).metodo, 'GET');
});

test('ler: form-data guarda o tipo de cada campo (texto ou arquivo)', () => {
  const r = lerRequisicao({
    corpo: { tipo: 'form-data', campos: [{ chave: 'a', valor: 'b', tipo: 'arquivo' }, { chave: 'c', valor: 'd', tipo: '?' }] },
  });
  assert.deepEqual(r.corpo.tipo === 'form-data' && r.corpo.campos.map((c) => c.tipo), ['arquivo', 'texto']);
});

test('a variável da resposta: JSON já lido; texto como texto; cabeçalhos num objeto', () => {
  const base = {
    tipo: 'http' as const, status: 200, statusTexto: 'OK', tempoMs: 12, tamanho: 9, url: 'http://h',
    headers: [['content-type', 'application/json; charset=utf-8'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']] as [string, string][],
    tipoDeConteudo: 'application/json; charset=utf-8', corpo: '{"id": 7}', codificacao: 'texto' as const, truncado: false,
  };
  const v = valorDaVariavel(base);
  assert.deepEqual(v.body, { id: 7 });
  assert.equal(v.status, 200);
  assert.equal(v.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(v.headers['set-cookie'], 'a=1, b=2');
  assert.equal(valorDaVariavel({ ...base, corpo: '{quebrado' }).body, '{quebrado');
  assert.equal(valorDaVariavel({ ...base, tipoDeConteudo: 'text/plain', corpo: '{"id": 7}' }).body, '{"id": 7}');
});

test('a variável da resposta: JSON com "+json" (problem+json, vnd.api+json) também é lido', () => {
  const v = valorDaVariavel({
    tipo: 'http', status: 400, statusTexto: 'Bad Request', tempoMs: 1, tamanho: 2, url: 'http://h', headers: [],
    tipoDeConteudo: 'application/problem+json', corpo: '{"erro":1}', codificacao: 'texto', truncado: false,
  });
  assert.deepEqual(v.body, { erro: 1 });
});

// ---- O resto do notebook enxerga a célula HTTP ----
import { alterarCelula, inserirCelula, notebookNovo, type Notebook } from '../notebook/modelo';
import { declaracoesDoNotebook } from '../notebook/declaracoes';
import { exportarIpynb } from '../notebook/ipynb';

function comHttp(): Notebook {
  const nb = inserirCelula({ ...notebookNovo('python', null), celulas: [] }, 'http', 0, 'h');
  return alterarCelula(nb, 'h', {
    nome: 'login',
    http: { ...requisicaoVazia(), metodo: 'POST', url: 'http://h/login', corpo: { tipo: 'raw', formato: 'json', texto: '{"u": 1}' } },
  });
}

test('editor TS: a variável da célula HTTP é declarada com o formato da resposta', () => {
  const d = declaracoesDoNotebook(comHttp(), null);
  assert.match(d, /declare var login: \{ status: number;[^}]*body: any;/);
});

test('.ipynb: a célula HTTP vira Markdown com método, URL e corpo', () => {
  const nb = { ...comHttp(), celulas: [...comHttp().celulas, { ...notebookNovo('python', null).celulas[0], id: 'p' }] };
  const ipynb = JSON.parse(exportarIpynb(nb, () => ''));
  const texto = ipynb.cells[0].source.join('');
  assert.equal(ipynb.cells[0].cell_type, 'markdown');
  assert.match(texto, /POST http:\/\/h\/login/);
  assert.match(texto, /\{"u": 1\}/);
  assert.match(texto, /`login`/);
});

test('URL → Params: apagar o primeiro param não perde a descrição dos outros', () => {
  const r = {
    ...requisicaoVazia(), url: 'http://h/x?a=1&b=2',
    params: [{ ...linha('a', '1'), descricao: 'do a' }, { ...linha('b', '2'), descricao: 'do b' }],
  };
  assert.equal(aoEditarUrl(r, 'http://h/x?b=2').params[0].descricao, 'do b');
});

test('editor TS: com "para cada", a variável é uma LISTA de respostas, cada uma com o item', () => {
  const nb = alterarCelula(comHttp(), 'h', { paraCada: 'pedidos' });
  assert.match(declaracoesDoNotebook(nb, null), /declare var login: Array<\{ status: number;[^}]*\} & \{ item: any \}>;/);
});
