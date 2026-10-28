// OAuth 2.0 na aba Authorization (spec 120, etapa 5): as contas puras.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lerRespostaDoToken, oauthVazio, pedidoDoToken, tokenValido, urlDeLogin,
} from '../notebook/oauth';
import {
  aplicarAutorizacao, lerRequisicao, referenciasDaRequisicao, referenciasDoCofre, requisicaoVazia,
  resolverRequisicao, type AutorizacaoHttp,
} from '../notebook/http';

const AGORA = Date.UTC(2026, 9, 28, 12);
type OAuth = Extract<AutorizacaoHttp, { tipo: 'oauth2' }>;
const cc = (extra: Partial<OAuth> = {}): OAuth => ({
  ...oauthVazio('http-tokens00000001'), fluxo: 'client_credentials', urlDoToken: 'https://auth.exemplo.test/token',
  clientId: 'meu-app', clientSecret: { texto: 's3gr3do' }, escopo: 'ler escrever', ...extra,
});
const campos = (c: readonly (readonly [string, string])[]) => Object.fromEntries(c);

test('oauth vazio: Client Credentials, credenciais no Basic, PKCE ligado, retorno em localhost:8765', () => {
  const o = oauthVazio('http-tokens00000001');
  assert.equal(o.fluxo, 'client_credentials');
  assert.equal(o.credenciaisNo, 'basic');
  assert.equal(o.pkce, true);
  assert.equal(o.urlDeRetorno, 'http://localhost:8765/callback');
  assert.equal(o.tokens, 'http-tokens00000001');
});

test('Client Credentials com Basic: client no header, grant e escopo no corpo', () => {
  const p = pedidoDoToken(cc(), {});
  assert.equal(p.url, 'https://auth.exemplo.test/token');
  assert.deepEqual(campos(p.campos), { grant_type: 'client_credentials', scope: 'ler escrever' });
  assert.equal(p.headers.Authorization, `Basic ${Buffer.from('meu-app:s3gr3do').toString('base64')}`);
});

test('credenciais no CORPO: client_id e client_secret vão no formulário', () => {
  const p = pedidoDoToken(cc({ credenciaisNo: 'corpo' }), {});
  assert.deepEqual(campos(p.campos), { grant_type: 'client_credentials', scope: 'ler escrever', client_id: 'meu-app', client_secret: 's3gr3do' });
  assert.equal(p.headers.Authorization, undefined);
});

test('Basic do client: id e secret codificados como manda a RFC 6749 (form-urlencoded)', () => {
  const p = pedidoDoToken(cc({ clientId: 'a:b', clientSecret: { texto: 'c d' } }), {});
  assert.equal(p.headers.Authorization, `Basic ${Buffer.from('a%3Ab:c+d').toString('base64')}`);
});

test('Password: usuário e senha no corpo', () => {
  const p = pedidoDoToken(cc({ fluxo: 'password', usuario: 'ana', senha: { texto: 'pw' } }), {});
  assert.deepEqual(campos(p.campos), { grant_type: 'password', username: 'ana', password: 'pw', scope: 'ler escrever' });
});

test('Authorization Code: code, redirect_uri e code_verifier (PKCE)', () => {
  const p = pedidoDoToken(cc({ fluxo: 'authorization_code' }), { codigo: 'c0d3', verificador: 'v3r' });
  assert.deepEqual(campos(p.campos), {
    grant_type: 'authorization_code', code: 'c0d3', redirect_uri: 'http://localhost:8765/callback', code_verifier: 'v3r',
  });
});

test('refresh: grant refresh_token com o refresh guardado', () => {
  const p = pedidoDoToken(cc(), { refresh: 'r1' });
  assert.deepEqual(campos(p.campos), { grant_type: 'refresh_token', refresh_token: 'r1', scope: 'ler escrever' });
});

test('URL de login: response_type=code, state, PKCE S256, escopo; preserva a query que já tinha', () => {
  const u = new URL(urlDeLogin(cc({ fluxo: 'authorization_code', urlDeAutorizacao: 'https://auth.exemplo.test/authorize?tenant=x' }),
    'st4te', 'd3safio'));
  assert.equal(u.searchParams.get('tenant'), 'x');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'meu-app');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:8765/callback');
  assert.equal(u.searchParams.get('state'), 'st4te');
  assert.equal(u.searchParams.get('code_challenge'), 'd3safio');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('scope'), 'ler escrever');
  const semPkce = new URL(urlDeLogin(cc({ fluxo: 'authorization_code', urlDeAutorizacao: 'https://a/authorize', pkce: false }), 's', null));
  assert.equal(semPkce.searchParams.get('code_challenge'), null);
});

test('resposta do token: lida, com validade e refresh', () => {
  const t = lerRespostaDoToken(200, '{"access_token":"a1","token_type":"bearer","expires_in":3600,"refresh_token":"r1"}', AGORA);
  assert.deepEqual(t, { acesso: 'a1', tipo: 'bearer', refresh: 'r1', expiraEm: AGORA + 3600_000 });
});

test('resposta de erro: o error_description do provedor no recado', () => {
  assert.throws(() => lerRespostaDoToken(400, '{"error":"invalid_client","error_description":"Client secret errado"}', AGORA),
    /invalid_client: Client secret errado/);
  assert.throws(() => lerRespostaDoToken(200, '{"token_type":"bearer"}', AGORA), /access_token/);
  assert.throws(() => lerRespostaDoToken(500, '<html>erro</html>', AGORA), /500/);
});

test('validade: com folga de 30 s; sem expires_in vale até a API recusar', () => {
  const t = { acesso: 'a', tipo: 'bearer', refresh: null, expiraEm: AGORA + 60_000 };
  assert.equal(tokenValido(t, AGORA), true);
  assert.equal(tokenValido(t, AGORA + 40_000), false);
  assert.equal(tokenValido({ ...t, expiraEm: null }, AGORA + 1e9), true);
});

test('na requisição: {{ }} nos campos do OAuth; secret e senha vão ao cofre; aplicar NÃO inventa header', () => {
  const r = { ...requisicaoVazia(), url: 'http://h', autorizacao: cc({ clientId: '{{app}}', clientSecret: { cofre: 'http-segredo000001' } }) };
  assert.deepEqual(referenciasDaRequisicao(r), ['app']);
  assert.deepEqual(referenciasDoCofre(r), ['http-segredo000001']);
  const resolvida = resolverRequisicao(r, { app: 'id-1' });
  assert.equal(resolvida.autorizacao.tipo === 'oauth2' && resolvida.autorizacao.clientId, 'id-1');
  // O token é do motor (cofre + provedor); sem ele, aplicar não põe nada.
  assert.deepEqual(aplicarAutorizacao({ ...r, autorizacao: cc() }).headers, []);
});

test('ler do arquivo: oauth2 conferido campo a campo', () => {
  const lido = lerRequisicao({ autorizacao: { tipo: 'oauth2', fluxo: 'implicit', tokens: '../x', clientId: 3 } }).autorizacao;
  assert.equal(lido.tipo, 'oauth2');
  assert.equal(lido.tipo === 'oauth2' && lido.fluxo, 'client_credentials');
  assert.equal(lido.tipo === 'oauth2' && lido.tokens, '');
  assert.equal(lido.tipo === 'oauth2' && lido.clientId, '3');
});
