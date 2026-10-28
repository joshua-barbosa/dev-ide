// OAuth 2.0 da célula HTTP no motor (spec 120, etapa 5).
//
// Decisão dele (28/10): Client Credentials, Password, Authorization Code com
// PKCE e a renovação pelo refresh token. Os TOKENS ficam no cofre, na
// referência da célula — o `.brnb` nunca os vê.
//
// Client Credentials e Password pegam o token SOZINHOS na primeira requisição
// (não há nada a perguntar a ninguém). Authorization Code precisa do login no
// navegador: "Pegar token novo" abre a página do provedor, e o motor espera o
// retorno numa porta desta máquina (a URL de retorno registrada no provedor).
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  lerRespostaDoToken, pedidoDoToken, tokenValido, urlDeLogin, type TokensOAuth,
} from '../../shared/notebook/oauth';
import {
  ocultarSegredos, opcoesPadrao, requisicaoVazia, type AutorizacaoOAuth, type OpcoesHttp, type RequisicaoHttp,
} from '../../shared/notebook/http';
import type { RespostaCompleta } from './requisicao-http';

/** Quanto tempo o motor espera o login no navegador. */
const PRAZO_DO_LOGIN_MS = 5 * 60_000;

export interface DepsDoOAuth {
  /** Manda o pedido do token (com o proxy e o certificado da célula). */
  enviar(requisicao: RequisicaoHttp, sinal?: AbortSignal): Promise<RespostaCompleta>;
  guardar(ref: string, valor: string): void;
  ler(ref: string): string | null;
  apagar(ref: string): void;
  agora?: () => number;
}

export type EstadoDoLogin =
  | { readonly estado: 'esperando' }
  /** O retorno chegou; o código está sendo trocado pelo token. */
  | { readonly estado: 'trocando' }
  | { readonly estado: 'pronto' }
  | { readonly estado: 'erro'; readonly erro: string };

interface Login {
  estado: EstadoDoLogin;
  readonly servidores: Server[];
  readonly prazo: ReturnType<typeof setTimeout>;
}

const SEM_TOKEN_DO_CODIGO =
  'Authorization: OAuth 2.0 (Authorization Code) sem token. Clique em "Pegar token novo" na aba Authorization — ' +
  'abre o login do provedor.';

const escaparHtml = (t: string): string =>
  t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const pagina = (titulo: string, texto: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Braytech Code</title>` +
  `<body style="font-family:sans-serif;margin:3rem"><h2>${escaparHtml(titulo)}</h2><p>${escaparHtml(texto)}</p></body>`;

/** A URL de retorno precisa ser desta máquina, http, com porta: é o motor que a escuta. */
function retornoLocal(texto: string): URL {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new Error(`URL de retorno inválida: ${texto}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(host) || url.port === '') {
    throw new Error(
      `A URL de retorno precisa ser http://localhost:PORTA/… (ou 127.0.0.1): é o motor desta máquina que espera o ` +
        `login. Recebi ${texto}.`
    );
  }
  return url;
}

export class OAuthDoNotebook {
  private readonly logins = new Map<string, Login>();
  /** Um login por porta: começar outro na mesma porta encerra o anterior. */
  private readonly porPorta = new Map<string, string>();
  /** Tokens de célula sem referência (não guarda no cofre): só nesta sessão do motor. */
  private readonly semCofre = new Map<string, TokensOAuth>();

  constructor(private readonly deps: DepsDoOAuth) {}

  private agora(): number {
    return this.deps.agora?.() ?? Date.now();
  }

  private lerTokens(a: AutorizacaoOAuth): TokensOAuth | null {
    if (a.tokens === '') return this.semCofre.get(a.urlDoToken + a.clientId) ?? null;
    const bruto = this.deps.ler(a.tokens);
    if (bruto === null) return null;
    try {
      return JSON.parse(bruto) as TokensOAuth;
    } catch {
      return null;
    }
  }

  private guardarTokens(a: AutorizacaoOAuth, t: TokensOAuth): void {
    if (a.tokens === '') this.semCofre.set(a.urlDoToken + a.clientId, t);
    else this.deps.guardar(a.tokens, JSON.stringify(t));
  }

  /** Pede ao endpoint de token. A renovação que não traz refresh novo mantém o antigo. */
  private async pedir(
    a: AutorizacaoOAuth, opcoes: OpcoesHttp, extra: Parameters<typeof pedidoDoToken>[1], sinal?: AbortSignal
  ): Promise<TokensOAuth> {
    if (a.urlDoToken.trim() === '') throw new Error('OAuth 2.0: escreva a URL do token na aba Authorization.');
    const p = pedidoDoToken(a, extra);
    const requisicao: RequisicaoHttp = {
      ...requisicaoVazia(),
      metodo: 'POST',
      url: p.url,
      headers: [
        ...Object.entries(p.headers).map(([chave, valor]) => ({ ligado: true, chave, valor, descricao: '' })),
        { ligado: true, chave: 'Accept', valor: 'application/json', descricao: '' },
      ],
      corpo: { tipo: 'urlencoded', campos: p.campos.map(([chave, valor]) => ({ ligado: true, chave, valor, descricao: '' })) },
      // O proxy e o certificado da célula valem para o provedor também. O
      // redirecionamento NÃO: o client secret e a senha iriam no corpo para
      // outro endereço (revisão de 28/10). Endpoint de token não redireciona.
      opcoes: { ...opcoesPadrao(), ...opcoes, seguirRedirecionamentos: false },
    };
    // Um provedor que ecoa o formulário no erro não pode pôr o secret na tela.
    const segredos = p.campos
      .filter(([k]) => ['client_secret', 'password', 'refresh_token', 'code', 'code_verifier'].includes(k))
      .map(([, v]) => v)
      .concat('texto' in a.clientSecret ? [a.clientSecret.texto] : []);
    let t: TokensOAuth;
    try {
      const r = await this.deps.enviar(requisicao, sinal);
      t = lerRespostaDoToken(r.status, r.corpo.toString('utf8'), this.agora());
    } catch (e) {
      throw new Error(ocultarSegredos(e instanceof Error ? e.message : String(e), segredos));
    }
    const comRefresh = t.refresh === null && extra.refresh !== undefined ? { ...t, refresh: extra.refresh } : t;
    this.guardarTokens(a, comRefresh);
    return comRefresh;
  }

  /**
   * Um token NOVO, mesmo havendo um guardado: pelo refresh se houver; senão
   * pelo fluxo (Client Credentials, Password). O Authorization Code sem
   * refresh precisa do login de novo.
   */
  async renovar(a: AutorizacaoOAuth, opcoes: OpcoesHttp, sinal?: AbortSignal): Promise<TokensOAuth> {
    const atual = this.lerTokens(a);
    if (atual?.refresh) {
      try {
        return await this.pedir(a, opcoes, { refresh: atual.refresh }, sinal);
      } catch (e) {
        // Refresh vencido ou revogado: cai para o fluxo, quando ele não precisa de gente.
        if (a.fluxo === 'authorization_code') throw e;
      }
    }
    if (a.fluxo === 'authorization_code') throw new Error(SEM_TOKEN_DO_CODIGO);
    return this.pedir(a, opcoes, {}, sinal);
  }

  /** O token para mandar agora. `doCofre`: veio guardado (um 401 merece outra tentativa). */
  async token(a: AutorizacaoOAuth, opcoes: OpcoesHttp, sinal?: AbortSignal): Promise<{ acesso: string; doCofre: boolean }> {
    const atual = this.lerTokens(a);
    if (atual !== null && tokenValido(atual, this.agora())) return { acesso: atual.acesso, doCofre: true };
    const novo = await this.renovar(a, opcoes, sinal);
    return { acesso: novo.acesso, doCofre: false };
  }

  /** O token guardado, se houver — o "Copiar cURL" o põe como Bearer. Não pede nada a ninguém. */
  tokenGuardado(a: AutorizacaoOAuth): string | null {
    return this.lerTokens(a)?.acesso ?? null;
  }

  /** O que a tela mostra: tem token, até quando, e se renova sozinho. Nunca o token. */
  estado(ref: string): { tem: boolean; expiraEm: number | null; temRefresh: boolean } {
    const t = this.lerTokens({ tokens: ref } as AutorizacaoOAuth);
    return { tem: t !== null, expiraEm: t?.expiraEm ?? null, temRefresh: (t?.refresh ?? null) !== null };
  }

  limpar(ref: string): void {
    this.deps.apagar(ref);
  }

  /** Authorization Code: escuta a URL de retorno e devolve a página de login a abrir. */
  async iniciarLogin(a: AutorizacaoOAuth, opcoes: OpcoesHttp): Promise<{ id: string; url: string }> {
    const retorno = retornoLocal(a.urlDeRetorno);
    if (a.urlDeAutorizacao.trim() === '') throw new Error('OAuth 2.0: escreva a URL de autorização (login) na aba Authorization.');
    const id = randomBytes(8).toString('hex');
    const state = randomBytes(16).toString('hex');
    const verificador = a.pkce ? randomBytes(32).toString('base64url') : null;
    const desafio = verificador === null ? null : createHash('sha256').update(verificador).digest('base64url');
    const url = urlDeLogin(a, state, desafio);

    const anterior = this.porPorta.get(retorno.port);
    if (anterior !== undefined) this.encerrar(anterior, { estado: 'erro', erro: 'Outro login começou nesta porta.' });

    const servidores: Server[] = [];
    const login: Login = {
      estado: { estado: 'esperando' },
      servidores,
      // Só quem ainda ESPERA: no meio da troca do código, quem decide é a troca.
      prazo: setTimeout(() => {
        if (login.estado.estado === 'esperando') this.encerrar(id, { estado: 'erro', erro: 'O login não voltou em 5 minutos.' });
      }, PRAZO_DO_LOGIN_MS),
    };
    const atender = createServer((req, res) => {
      const chegou = new URL(req.url ?? '/', retorno);
      if (chegou.pathname !== retorno.pathname || login.estado.estado !== 'esperando') {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pagina('Nada aqui', 'Este endereço só espera o retorno de um login da Braytech Code.'));
        return;
      }
      // O state amarra o retorno ao login que ESTE motor começou: outra página
      // não consegue empurrar um código dela.
      if (chegou.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pagina('Retorno recusado', 'O state não confere com o login que a Braytech Code começou.'));
        return;
      }
      const erro = chegou.searchParams.get('error');
      const codigo = chegou.searchParams.get('code');
      if (erro !== null || codigo === null) {
        const recado = `O provedor recusou o login (${erro ?? 'sem código'}${chegou.searchParams.get('error_description') ? `: ${chegou.searchParams.get('error_description')}` : ''}).`;
        login.estado = { estado: 'erro', erro: recado };
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(pagina('Login recusado', recado), () => this.encerrar(id, { estado: 'erro', erro: recado }));
        return;
      }
      // Um retorno só: o navegador às vezes repete o pedido, e o código vale uma vez.
      login.estado = { estado: 'trocando' };
      this.pedir(a, opcoes, { codigo, verificador })
        .then(() => {
          login.estado = { estado: 'pronto' };
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          // Fecha DEPOIS de a página chegar: fechar antes cortaria a resposta no meio.
          res.end(pagina('Login concluído', 'Pode fechar esta aba e voltar à Braytech Code.'), () => this.encerrar(id, { estado: 'pronto' }));
        })
        .catch((e: unknown) => {
          const recado = e instanceof Error ? e.message : String(e);
          login.estado = { estado: 'erro', erro: recado };
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(pagina('Não deu para pegar o token', recado), () => this.encerrar(id, { estado: 'erro', erro: recado }));
        });
    });
    servidores.push(atender);
    // "localhost" pode resolver para 127.0.0.1 ou ::1, conforme o navegador: escuta os dois.
    const hosts = retorno.hostname === 'localhost' ? ['127.0.0.1', '::1'] : [retorno.hostname.replace(/^\[|\]$/g, '')];
    await new Promise<void>((resolver, rejeitar) => {
      atender.once('error', (e: NodeJS.ErrnoException) => rejeitar(new Error(
        e.code === 'EADDRINUSE'
          ? `A porta ${retorno.port} da URL de retorno já está em uso nesta máquina. Feche quem a usa, ou troque a URL (e registre a nova no provedor).`
          : `Não deu para esperar o retorno em ${retorno.host}: ${e.message}`
      )));
      atender.listen(Number(retorno.port), hosts[0], () => resolver());
    }).catch((e: unknown) => {
      clearTimeout(login.prazo);
      throw e;
    });
    if (hosts.length > 1) {
      const outro = createServer((req, res) => atender.emit('request', req, res));
      servidores.push(outro);
      // Sem IPv6 nesta máquina: fica só o 127.0.0.1. Mas a porta ocupada no ::1
      // por OUTRO programa é erro: o navegador poderia entregar o código a ele.
      await new Promise<void>((resolver, rejeitar) => {
        outro.once('error', (e: NodeJS.ErrnoException) => {
          if (e.code !== 'EADDRINUSE') {
            resolver();
            return;
          }
          clearTimeout(login.prazo);
          for (const s of servidores) s.close();
          rejeitar(new Error(`A porta ${retorno.port} (IPv6, ::1) já está em uso por outro programa. Troque a URL de retorno.`));
        });
        outro.listen(Number(retorno.port), hosts[1], () => resolver());
      });
    }
    this.logins.set(id, login);
    this.porPorta.set(retorno.port, id);
    return { id, url };
  }

  estadoDoLogin(id: string): EstadoDoLogin {
    return this.logins.get(id)?.estado ?? { estado: 'erro', erro: 'Este login não existe mais (o motor reiniciou?).' };
  }

  private encerrar(id: string, estado: EstadoDoLogin): void {
    const login = this.logins.get(id);
    if (login === undefined) return;
    login.estado = estado;
    clearTimeout(login.prazo);
    for (const s of login.servidores) {
      s.closeAllConnections();
      s.close();
    }
    for (const [porta, quem] of this.porPorta) if (quem === id) this.porPorta.delete(porta);
    // A tela pergunta o resultado logo depois; um minuto basta, e a memória não cresce.
    setTimeout(() => this.logins.delete(id), 60_000).unref();
  }
}
