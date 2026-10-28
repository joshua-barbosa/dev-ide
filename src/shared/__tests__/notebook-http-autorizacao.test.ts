// A aba Authorization da célula HTTP (spec 120, etapa 2): Bearer, Basic e API
// Key, com o segredo no cofre e só a REFERÊNCIA no `.brnb`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarAutorizacao, lerRequisicao, referenciasDaRequisicao, referenciasDoCofre, requisicaoVazia,
  resolverRequisicao, semCofre, type RequisicaoHttp,
} from '../notebook/http';

const REF = 'http-0123456789ab';
const comAuth = (autorizacao: RequisicaoHttp['autorizacao'], extra: Partial<RequisicaoHttp> = {}): RequisicaoHttp =>
  ({ ...requisicaoVazia(), url: 'http://h/x', autorizacao, ...extra });

test('requisição nova: sem autorização', () => {
  assert.deepEqual(requisicaoVazia().autorizacao, { tipo: 'nenhuma' });
});

test('Bearer: vira o header Authorization', () => {
  const r = aplicarAutorizacao(comAuth({ tipo: 'bearer', token: { texto: 'abc' } }));
  assert.deepEqual(r.headers.map((h) => [h.chave, h.valor]), [['Authorization', 'Bearer abc']]);
});

test('Bearer vazio: nenhum header (não manda "Bearer " sozinho)', () => {
  assert.deepEqual(aplicarAutorizacao(comAuth({ tipo: 'bearer', token: { texto: '' } })).headers, []);
});

test('Basic: usuário:senha em base64, com acento (UTF-8)', () => {
  const r = aplicarAutorizacao(comAuth({ tipo: 'basic', usuario: 'joão', senha: { texto: 'sé' } }));
  assert.equal(r.headers[0].valor, `Basic ${Buffer.from('joão:sé', 'utf8').toString('base64')}`);
});

test('API Key no header e na query', () => {
  const h = aplicarAutorizacao(comAuth({ tipo: 'apikey', chave: 'X-Api-Key', valor: { texto: 'k1' }, onde: 'header' }));
  assert.deepEqual(h.headers.map((x) => [x.chave, x.valor]), [['X-Api-Key', 'k1']]);
  const q = aplicarAutorizacao(comAuth({ tipo: 'apikey', chave: 'api key', valor: { texto: 'a&b' }, onde: 'query' }, { url: 'http://h/x?a=1#f' }));
  assert.equal(q.url, 'http://h/x?a=1&api%20key=a%26b#f');
  const semQuery = aplicarAutorizacao(comAuth({ tipo: 'apikey', chave: 'k', valor: { texto: 'v' }, onde: 'query' }));
  assert.equal(semQuery.url, 'http://h/x?k=v');
});

test('header escrito à mão vale mais que o da aba Authorization', () => {
  const r = aplicarAutorizacao(comAuth({ tipo: 'bearer', token: { texto: 'da-aba' } }, {
    headers: [{ ligado: true, chave: 'authorization', valor: 'Bearer na-mao', descricao: '' }],
  }));
  assert.deepEqual(r.headers.map((h) => h.valor), ['Bearer na-mao']);
});

test('referências do cofre: só as que vêm do cofre', () => {
  assert.deepEqual(referenciasDoCofre(comAuth({ tipo: 'bearer', token: { cofre: REF } })), [REF]);
  assert.deepEqual(referenciasDoCofre(comAuth({ tipo: 'bearer', token: { texto: '{{t}}' } })), []);
  assert.deepEqual(referenciasDoCofre(comAuth({ tipo: 'basic', usuario: 'u', senha: { cofre: REF } })), [REF]);
});

test('semCofre: troca a referência pelo valor; ausente é erro que diz o que fazer', () => {
  const r = semCofre(comAuth({ tipo: 'bearer', token: { cofre: REF } }), { [REF]: 'tk' });
  assert.deepEqual(r.autorizacao, { tipo: 'bearer', token: { texto: 'tk' } });
  assert.throws(
    () => semCofre(comAuth({ tipo: 'bearer', token: { cofre: REF } }), { [REF]: null }),
    /token não está neste computador.*Authorization/
  );
});

test('{{ }} vale nos campos da Authorization', () => {
  const r = comAuth({ tipo: 'basic', usuario: '{{u}}', senha: { texto: '{{s.x}}' } });
  assert.deepEqual(referenciasDaRequisicao(r).sort(), ['s', 'u']);
  const resolvida = resolverRequisicao(r, { u: 'ana', s: { x: 'pw' } });
  assert.deepEqual(resolvida.autorizacao, { tipo: 'basic', usuario: 'ana', senha: { texto: 'pw' } });
});

test('ler do arquivo: referência fora do formato vira campo vazio; tipo estranho vira nenhuma', () => {
  assert.deepEqual(lerRequisicao({ autorizacao: { tipo: 'bearer', token: { cofre: '../x' } } }).autorizacao,
    { tipo: 'bearer', token: { texto: '' } });
  assert.deepEqual(lerRequisicao({ autorizacao: { tipo: 'digest' } }).autorizacao, { tipo: 'nenhuma' });
  assert.deepEqual(lerRequisicao({}).autorizacao, { tipo: 'nenhuma' });
  assert.deepEqual(
    lerRequisicao({ autorizacao: { tipo: 'apikey', chave: 'k', valor: { cofre: REF }, onde: 'x' } }).autorizacao,
    { tipo: 'apikey', chave: 'k', valor: { cofre: REF }, onde: 'header' }
  );
});

// ---- o .ipynb diz que há autorização, sem levar segredo nem referência ----
import { alterarCelula, inserirCelula, notebookNovo } from '../notebook/modelo';
import { exportarIpynb } from '../notebook/ipynb';

test('.ipynb: "Authorization: Bearer (no cofre)", sem a referência', () => {
  const nb = alterarCelula(inserirCelula({ ...notebookNovo('python', null), celulas: [] }, 'http', 0, 'h'), 'h', {
    http: comAuth({ tipo: 'bearer', token: { cofre: REF } }),
  });
  const texto = JSON.parse(exportarIpynb(nb, () => '')).cells[0].source.join('');
  assert.match(texto, /Authorization: Bearer Token \(segredo no cofre\)/);
  assert.equal(texto.includes(REF), false);
});

import { ocultarSegredos, segredosDaAutorizacao } from '../notebook/http';

test('ocultar: o segredo some do texto, cru e codificado na URL', () => {
  assert.equal(ocultarSegredos('http://h/x?k=a%26b&z=1', ['a&b']), 'http://h/x?k=••••••&z=1');
  assert.equal(ocultarSegredos('erro com tk-1 dentro', ['tk-1']), 'erro com •••••• dentro');
  assert.equal(ocultarSegredos('nada', ['']), 'nada');
});

test('segredosDaAutorizacao: os valores secretos já trocados (para ocultar depois)', () => {
  assert.deepEqual(segredosDaAutorizacao({ tipo: 'apikey', chave: 'k', valor: { texto: 'v' }, onde: 'query' }), ['v']);
  assert.deepEqual(segredosDaAutorizacao({ tipo: 'basic', usuario: 'u', senha: { texto: 'p' } }), ['p']);
  assert.deepEqual(segredosDaAutorizacao({ tipo: 'nenhuma' }), []);
});
