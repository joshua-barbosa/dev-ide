// OAuth 2.0 da célula HTTP (spec 120, etapa 5): as contas, sem rede.
//
// O pedido do token (RFC 6749): Client Credentials, Password, Authorization
// Code (com PKCE, RFC 7636) e a renovação pelo refresh token. O motor faz a
// conversa (`server/notebook/oauth-http.ts`); aqui só se monta e se lê.
import type { AutorizacaoOAuth } from './http';

export { oauthVazio } from './http';

/** Os tokens recebidos, como ficam no cofre. */
export interface TokensOAuth {
  readonly acesso: string;
  readonly tipo: string;
  readonly refresh: string | null;
  /** Em ms; `null` = o provedor não disse (vale até a API recusar). */
  readonly expiraEm: number | null;
}

/** Folga antes do vencimento: um token a 10 s do fim morre no caminho. */
const FOLGA_MS = 30_000;

export function tokenValido(t: TokensOAuth, agora: number): boolean {
  return t.expiraEm === null || t.expiraEm - FOLGA_MS > agora;
}

export interface PedidoDoToken {
  readonly url: string;
  readonly campos: readonly (readonly [string, string])[];
  readonly headers: Readonly<Record<string, string>>;
}

const textoDe = (c: AutorizacaoOAuth['clientSecret']): string => ('texto' in c ? c.texto : '');

/** O client no header Basic: id e secret codificados como formulário ANTES do base64 (RFC 6749, 2.3.1). */
function basicDoClient(id: string, secret: string): string {
  const cod = (t: string) => encodeURIComponent(t).replace(/%20/g, '+');
  const par = `${cod(id)}:${cod(secret)}`;
  let binario = '';
  for (const b of new TextEncoder().encode(par)) binario += String.fromCharCode(b);
  return `Basic ${btoa(binario)}`;
}

/**
 * O pedido ao endpoint de token. `refresh` presente = renovação; `codigo` =
 * troca do Authorization Code. Espera os segredos já trocados (texto).
 */
export function pedidoDoToken(
  a: AutorizacaoOAuth, extra: { readonly codigo?: string; readonly verificador?: string | null; readonly refresh?: string }
): PedidoDoToken {
  const campos: [string, string][] = [];
  const escopo = (): void => {
    if (a.escopo.trim() !== '') campos.push(['scope', a.escopo.trim()]);
  };
  if (extra.refresh !== undefined) {
    campos.push(['grant_type', 'refresh_token'], ['refresh_token', extra.refresh]);
    escopo();
  } else if (a.fluxo === 'authorization_code') {
    campos.push(['grant_type', 'authorization_code'], ['code', extra.codigo ?? ''], ['redirect_uri', a.urlDeRetorno]);
    if (extra.verificador !== undefined && extra.verificador !== null) campos.push(['code_verifier', extra.verificador]);
  } else if (a.fluxo === 'password') {
    campos.push(['grant_type', 'password'], ['username', a.usuario], ['password', textoDe(a.senha)]);
    escopo();
  } else {
    campos.push(['grant_type', 'client_credentials']);
    escopo();
  }
  const secret = textoDe(a.clientSecret);
  const headers: Record<string, string> = {};
  if (a.credenciaisNo === 'basic') {
    headers.Authorization = basicDoClient(a.clientId, secret);
  } else {
    campos.push(['client_id', a.clientId]);
    if (secret !== '') campos.push(['client_secret', secret]);
  }
  return { url: a.urlDoToken, campos, headers };
}

/** A página de login do provedor (Authorization Code). `desafio` = PKCE S256. */
export function urlDeLogin(a: AutorizacaoOAuth, state: string, desafio: string | null): string {
  const url = new URL(a.urlDeAutorizacao);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', a.clientId);
  url.searchParams.set('redirect_uri', a.urlDeRetorno);
  url.searchParams.set('state', state);
  if (a.escopo.trim() !== '') url.searchParams.set('scope', a.escopo.trim());
  if (desafio !== null) {
    url.searchParams.set('code_challenge', desafio);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/** A resposta do endpoint de token. Erro do provedor vira recado com o `error_description` dele. */
export function lerRespostaDoToken(status: number, corpo: string, agora: number): TokensOAuth {
  let json: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(corpo);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) json = v as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (json !== null && typeof json.error === 'string') {
    const detalhe = typeof json.error_description === 'string' ? `: ${json.error_description}` : '';
    throw new Error(`O provedor recusou o token (${json.error}${detalhe}).`);
  }
  if (status >= 400 || json === null) {
    throw new Error(`O endpoint de token respondeu ${status}: ${corpo.slice(0, 200)}`);
  }
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    throw new Error('A resposta do token não tem access_token.');
  }
  const expira = typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in);
  return {
    acesso: json.access_token,
    tipo: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    refresh: typeof json.refresh_token === 'string' && json.refresh_token !== '' ? json.refresh_token : null,
    expiraEm: Number.isFinite(expira) && expira > 0 ? agora + expira * 1000 : null,
  };
}
