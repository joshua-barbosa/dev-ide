// A célula HTTP do notebook (spec 120): o formato e as contas, sem rede.
//
// O pedido (28/10): *"bloco HTTP request tipo o Postman, onde pode ser
// configurado o tipo de requisição, url, payload (none/form-data/
// x-www-form-urlencoded/raw[TEXT/JSON/HTML/XML]/binary), params,
// authorization, headers"*.
//
// Como no Postman, a URL é a fonte da verdade da query: a aba Params é a mesma
// query em tabela. A diferença é a linha DESLIGADA — ela não está na URL, então
// fica só na tabela, e editar a URL não pode apagá-la.
//
// `{{ }}` vale em todos os campos (decisão dele, 28/10). Aqui é troca de TEXTO:
// diferente do SQL, não há parâmetro para onde mandar o valor.
//
// PURO e imutável, como `modelo.ts`: IDE e extensão usam o mesmo código.

export const METODOS_HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type MetodoHttp = (typeof METODOS_HTTP)[number];

export const FORMATOS_RAW = ['texto', 'json', 'html', 'xml'] as const;
export type FormatoRaw = (typeof FORMATOS_RAW)[number];

/** Uma linha de Params, Headers ou x-www-form-urlencoded. */
export interface LinhaHttp {
  readonly ligado: boolean;
  readonly chave: string;
  readonly valor: string;
  readonly descricao: string;
}

/** Uma linha do form-data: texto, ou um ARQUIVO (o valor é o caminho absoluto). */
export interface CampoDeFormulario extends LinhaHttp {
  readonly tipo: 'texto' | 'arquivo';
}

export type CorpoHttp =
  | { readonly tipo: 'nenhum' }
  | { readonly tipo: 'form-data'; readonly campos: readonly CampoDeFormulario[] }
  | { readonly tipo: 'urlencoded'; readonly campos: readonly LinhaHttp[] }
  | { readonly tipo: 'raw'; readonly formato: FormatoRaw; readonly texto: string }
  /** O arquivo inteiro é o corpo. Caminho absoluto (decisão dele, 28/10). */
  | { readonly tipo: 'binario'; readonly arquivo: string };

export type TipoDeCorpo = CorpoHttp['tipo'];

/**
 * Um campo de segredo da aba Authorization (etapa 2). Decisão dele (28/10):
 * o valor vai para o COFRE e o `.brnb` guarda só a referência — o arquivo
 * pode ir para um git. Um `{{variavel}}` digitado no campo não é segredo: fica
 * no arquivo como texto, e é trocado como em qualquer campo.
 */
export type CampoSecreto = { readonly cofre: string } | { readonly texto: string };

export type AutorizacaoHttp =
  | { readonly tipo: 'nenhuma' }
  | { readonly tipo: 'bearer'; readonly token: CampoSecreto }
  | { readonly tipo: 'basic'; readonly usuario: string; readonly senha: CampoSecreto }
  | {
      readonly tipo: 'apikey';
      readonly chave: string;
      readonly valor: CampoSecreto;
      readonly onde: 'header' | 'query';
    }
  | AutorizacaoOAuth;

export const FLUXOS_OAUTH = ['client_credentials', 'password', 'authorization_code'] as const;
export type FluxoOAuth = (typeof FLUXOS_OAUTH)[number];

/**
 * OAuth 2.0 (etapa 5). Decisão dele (28/10): os três fluxos e a renovação
 * pelo refresh token. O client secret e a senha são campos de segredo (cofre
 * ou `{{ }}`); os TOKENS recebidos ficam no cofre, na referência `tokens` —
 * o `.brnb` nunca os vê.
 */
export interface AutorizacaoOAuth {
  readonly tipo: 'oauth2';
  readonly fluxo: FluxoOAuth;
  readonly urlDoToken: string;
  /** Só Authorization Code: a página de login do provedor. */
  readonly urlDeAutorizacao: string;
  /** Só Authorization Code: onde o motor espera o retorno (registrada no provedor). */
  readonly urlDeRetorno: string;
  readonly clientId: string;
  readonly clientSecret: CampoSecreto;
  readonly escopo: string;
  /** Só Password. */
  readonly usuario: string;
  readonly senha: CampoSecreto;
  /** Só Authorization Code. */
  readonly pkce: boolean;
  /** Como o client se identifica no pedido do token: header Basic ou no corpo. */
  readonly credenciaisNo: 'basic' | 'corpo';
  /** A referência do cofre onde ficam os tokens; vazio = não guardar. */
  readonly tokens: string;
}

export function oauthVazio(tokens: string): AutorizacaoOAuth {
  return {
    tipo: 'oauth2', fluxo: 'client_credentials', urlDoToken: '', urlDeAutorizacao: '',
    urlDeRetorno: 'http://localhost:8765/callback', clientId: '', clientSecret: { texto: '' }, escopo: '',
    usuario: '', senha: { texto: '' }, pkce: true, credenciaisNo: 'basic', tokens,
  };
}

export type TipoDeAutorizacao = AutorizacaoHttp['tipo'];

/** A mesma regra do cofre: `http-` + letras, números e hífen. */
export const REFERENCIA_DO_COFRE = /^[a-z]+-[A-Za-z0-9-]{8,64}$/;

/** A aba Settings (etapa 3). */
export interface OpcoesHttp {
  /** 0 = sem limite, como no Postman. */
  readonly timeoutMs: number;
  readonly seguirRedirecionamentos: boolean;
  /** Servidor interno com certificado próprio (decisão dele, 28/10). */
  readonly ignorarCertificado: boolean;
  /** Vazio = o do sistema (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`). */
  readonly proxy: string;
}

export function opcoesPadrao(): OpcoesHttp {
  return { timeoutMs: 0, seguirRedirecionamentos: true, ignorarCertificado: false, proxy: '' };
}

export interface RequisicaoHttp {
  readonly metodo: MetodoHttp;
  /** Com a query das linhas LIGADAS de `params`. */
  readonly url: string;
  readonly params: readonly LinhaHttp[];
  readonly headers: readonly LinhaHttp[];
  readonly autorizacao: AutorizacaoHttp;
  readonly corpo: CorpoHttp;
  readonly opcoes: OpcoesHttp;
}

/**
 * A resposta, como fica GUARDADA no `.brnb` e desenhada embaixo da célula.
 *
 * O corpo guardado tem teto (`SAIDA_HTTP_MAX_BYTES`): uma resposta de 50 MB não
 * pode virar um notebook de 50 MB. O kernel recebe a resposta inteira.
 */
export interface SaidaHttp {
  readonly tipo: 'http';
  readonly status: number;
  readonly statusTexto: string;
  readonly tempoMs: number;
  /** Bytes do corpo como chegou (depois de descomprimir). */
  readonly tamanho: number;
  /** A URL final — depois dos redirecionamentos. */
  readonly url: string;
  /** Em pares, na ordem: `set-cookie` aparece uma vez por cookie. */
  readonly headers: readonly (readonly [string, string])[];
  readonly tipoDeConteudo: string;
  readonly corpo: string;
  /** Binário (imagem, PDF, zip…) vai em base64. */
  readonly codificacao: 'texto' | 'base64';
  readonly truncado: boolean;
}

/** Quanto do corpo da resposta fica guardado no arquivo. */
export const SAIDA_HTTP_MAX_BYTES = 1024 * 1024;

export function requisicaoVazia(): RequisicaoHttp {
  return {
    metodo: 'GET', url: '', params: [], headers: [], autorizacao: { tipo: 'nenhuma' }, corpo: { tipo: 'nenhum' },
    opcoes: opcoesPadrao(),
  };
}

export function linhaVazia(): LinhaHttp {
  return { ligado: true, chave: '', valor: '', descricao: '' };
}

// ---------------------------------------------------------------------------
// URL ⇄ Params
// ---------------------------------------------------------------------------

/** A URL em três pedaços: antes do `?`, a query e o `#…`. */
export function partirUrl(url: string): { base: string; query: string | null; fragmento: string } {
  const cerquilha = url.indexOf('#');
  const fragmento = cerquilha === -1 ? '' : url.slice(cerquilha);
  const semFragmento = cerquilha === -1 ? url : url.slice(0, cerquilha);
  const interrogacao = semFragmento.indexOf('?');
  if (interrogacao === -1) return { base: semFragmento, query: null, fragmento };
  return { base: semFragmento.slice(0, interrogacao), query: semFragmento.slice(interrogacao + 1), fragmento };
}

/** A query como está escrita — SEM decodificar: `%20` continua `%20` na tabela, como no Postman. */
function linhasDaQuery(query: string | null): { chave: string; valor: string }[] {
  if (query === null || query === '') return [];
  return query.split('&').filter((p) => p !== '').map((par) => {
    const igual = par.indexOf('=');
    return igual === -1 ? { chave: par, valor: '' } : { chave: par.slice(0, igual), valor: par.slice(igual + 1) };
  });
}

/** Escreveu na URL: a tabela acompanha, e as linhas desligadas ficam no fim. */
export function aoEditarUrl(req: RequisicaoHttp, url: string): RequisicaoHttp {
  // A descrição não está na URL: vem da primeira linha ligada de mesma chave ainda não usada.
  const sobrando = req.params.filter((p) => p.ligado);
  const daUrl = linhasDaQuery(partirUrl(url).query).map((p): LinhaHttp => {
    const onde = sobrando.findIndex((a) => a.chave === p.chave);
    const descricao = onde === -1 ? '' : sobrando.splice(onde, 1)[0].descricao;
    return { ligado: true, chave: p.chave, valor: p.valor, descricao };
  });
  return { ...req, url, params: [...daUrl, ...req.params.filter((p) => !p.ligado)] };
}

/** Mexeu na tabela: a query da URL é refeita com as ligadas. */
export function aoEditarParams(req: RequisicaoHttp, params: readonly LinhaHttp[]): RequisicaoHttp {
  const { base, fragmento } = partirUrl(req.url);
  const query = params
    .filter((p) => p.ligado && (p.chave !== '' || p.valor !== ''))
    .map((p) => (p.valor === '' && p.chave !== '' ? p.chave : `${p.chave}=${p.valor}`))
    .join('&');
  return { ...req, params, url: `${base}${query === '' ? '' : `?${query}`}${fragmento}` };
}

// ---------------------------------------------------------------------------
// {{ }}
// ---------------------------------------------------------------------------

/** `{{nome}}`, `{{login.body.token}}`, `{{lista[0].id}}`. */
const REFERENCIA = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)\s*\}\}/g;

function referenciasDoTexto(texto: string): string[] {
  return [...texto.matchAll(REFERENCIA)].map((m) => m[1]);
}

/** Todos os textos que a requisição MANDA (linhas desligadas não contam). */
function textosDa(req: RequisicaoHttp): string[] {
  const ligadas = (linhas: readonly LinhaHttp[]) => linhas.filter((l) => l.ligado).flatMap((l) => [l.chave, l.valor]);
  const corpo = req.corpo;
  const doCorpo = corpo.tipo === 'raw' ? [corpo.texto]
    : corpo.tipo === 'binario' ? [corpo.arquivo]
      : corpo.tipo === 'form-data' || corpo.tipo === 'urlencoded' ? ligadas(corpo.campos)
        : [];
  return [req.url, ...ligadas(req.headers), ...textosDaAutorizacao(req.autorizacao), ...doCorpo];
}

const textoDe = (c: CampoSecreto): string[] => ('texto' in c ? [c.texto] : []);

function textosDaAutorizacao(a: AutorizacaoHttp): string[] {
  switch (a.tipo) {
    case 'bearer': return textoDe(a.token);
    case 'basic': return [a.usuario, ...textoDe(a.senha)];
    case 'apikey': return [a.chave, ...textoDe(a.valor)];
    case 'oauth2':
      return [a.urlDoToken, a.urlDeAutorizacao, a.clientId, a.escopo, a.usuario, ...textoDe(a.clientSecret), ...textoDe(a.senha)];
    default: return [];
  }
}

/** As variáveis do kernel que a requisição usa — o motor busca só estas. */
export function referenciasDaRequisicao(req: RequisicaoHttp): string[] {
  return [...new Set(textosDa(req).flatMap(referenciasDoTexto))];
}

function valorNoCaminho(valores: Readonly<Record<string, unknown>>, nome: string, caminho: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(valores, nome)) {
    throw new Error(`{{${nome}}}: a variável "${nome}" não existe no kernel. Rode antes a célula que a cria.`);
  }
  let atual: unknown = valores[nome];
  const passos = [...caminho.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g)];
  for (const passo of passos) {
    const chave = passo[1] ?? Number(passo[2]);
    const tem = atual !== null && typeof atual === 'object' && Object.prototype.hasOwnProperty.call(atual, chave);
    if (!tem) throw new Error(`{{${nome}${caminho}}}: "${nome}${caminho}" não existe.`);
    atual = (atual as Record<string | number, unknown>)[chave];
  }
  return atual;
}

/** Troca cada `{{ }}` pelo valor: texto entra cru; o resto, como JSON. */
export function interpolar(texto: string, valores: Readonly<Record<string, unknown>>): string {
  return texto.replace(REFERENCIA, (_tudo, nome: string, caminho: string) => {
    const v = valorNoCaminho(valores, nome, caminho);
    return typeof v === 'string' ? v : JSON.stringify(v) ?? 'null';
  });
}

/**
 * A requisição pronta para sair: `{{ }}` trocados e linhas desligadas FORA.
 * Uma linha desligada com `{{x}}` não pode exigir que `x` exista.
 */
export function resolverRequisicao(req: RequisicaoHttp, valores: Readonly<Record<string, unknown>>): RequisicaoHttp {
  const trocar = (t: string) => interpolar(t, valores);
  const linhas = <L extends LinhaHttp>(ls: readonly L[]): L[] =>
    ls.filter((l) => l.ligado).map((l) => ({ ...l, chave: trocar(l.chave), valor: trocar(l.valor) }));
  const c = req.corpo;
  const corpo: CorpoHttp = c.tipo === 'raw' ? { ...c, texto: trocar(c.texto) }
    : c.tipo === 'binario' ? { ...c, arquivo: trocar(c.arquivo) }
      : c.tipo === 'form-data' ? { ...c, campos: linhas(c.campos) }
        : c.tipo === 'urlencoded' ? { ...c, campos: linhas(c.campos) }
          : c;
  const campo = (c: CampoSecreto): CampoSecreto => ('texto' in c ? { texto: trocar(c.texto) } : c);
  const a = req.autorizacao;
  const autorizacao: AutorizacaoHttp = a.tipo === 'bearer' ? { ...a, token: campo(a.token) }
    : a.tipo === 'basic' ? { ...a, usuario: trocar(a.usuario), senha: campo(a.senha) }
      : a.tipo === 'apikey' ? { ...a, chave: trocar(a.chave), valor: campo(a.valor) }
        : a.tipo === 'oauth2' ? {
          ...a, urlDoToken: trocar(a.urlDoToken), urlDeAutorizacao: trocar(a.urlDeAutorizacao), clientId: trocar(a.clientId),
          escopo: trocar(a.escopo), usuario: trocar(a.usuario), clientSecret: campo(a.clientSecret), senha: campo(a.senha),
        }
          : a;
  return {
    ...req, url: trocar(req.url), params: linhas(req.params), headers: linhas(req.headers), autorizacao, corpo,
  };
}

// ---------------------------------------------------------------------------
// Authorization (etapa 2)
// ---------------------------------------------------------------------------

/** Os campos de segredo da autorização, com o nome que o recado usa. */
function camposSecretos(a: AutorizacaoHttp): { campo: CampoSecreto; nome: string }[] {
  switch (a.tipo) {
    case 'bearer': return [{ campo: a.token, nome: 'o token' }];
    case 'basic': return [{ campo: a.senha, nome: 'a senha' }];
    case 'apikey': return [{ campo: a.valor, nome: 'o valor da API Key' }];
    case 'oauth2': return [{ campo: a.clientSecret, nome: 'o client secret' }, { campo: a.senha, nome: 'a senha' }];
    default: return [];
  }
}

/** As referências que o motor busca no cofre antes de mandar. */
export function referenciasDoCofre(req: RequisicaoHttp): string[] {
  return camposSecretos(req.autorizacao).flatMap(({ campo }) => ('cofre' in campo ? [campo.cofre] : []));
}

/**
 * Troca cada referência pelo valor do cofre. Ausente (`null`) é ERRO que diz o
 * que fazer: o `.brnb` veio de outra máquina, e o segredo não veio junto.
 */
export function semCofre(req: RequisicaoHttp, valores: Readonly<Record<string, string | null>>): RequisicaoHttp {
  const trocar = (c: CampoSecreto, nome: string): CampoSecreto => {
    if (!('cofre' in c)) return c;
    const v = valores[c.cofre];
    if (v === null || v === undefined) {
      throw new Error(`Authorization: ${nome} não está neste computador. Digite de novo na aba Authorization.`);
    }
    return { texto: v };
  };
  const a = req.autorizacao;
  const autorizacao: AutorizacaoHttp = a.tipo === 'bearer' ? { ...a, token: trocar(a.token, 'o token') }
    : a.tipo === 'basic' ? { ...a, senha: trocar(a.senha, 'a senha') }
      : a.tipo === 'apikey' ? { ...a, valor: trocar(a.valor, 'o valor da API Key') }
        : a.tipo === 'oauth2' ? { ...a, clientSecret: trocar(a.clientSecret, 'o client secret'), senha: trocar(a.senha, 'a senha') }
          : a;
  return { ...req, autorizacao };
}

const textoDoCampo = (c: CampoSecreto): string => ('texto' in c ? c.texto : '');

/** Os valores secretos, já trocados (`semCofre` + `{{ }}`): o que não pode voltar na saída. */
export function segredosDaAutorizacao(a: AutorizacaoHttp): string[] {
  return camposSecretos(a).map(({ campo }) => textoDoCampo(campo)).filter((v) => v !== '');
}

const MASCARA = '••••••';

/**
 * Tira os segredos de um texto que vai ficar à vista ou no `.brnb` — a URL
 * final de uma API Key na query, um recado de erro. Cru e codificado como na
 * URL (`a&b` vira `a%26b` lá dentro).
 */
export function ocultarSegredos(texto: string, segredos: readonly string[]): string {
  let saida = texto;
  for (const s of segredos) {
    if (s === '') continue;
    for (const forma of new Set([s, encodeURIComponent(s)])) saida = saida.split(forma).join(MASCARA);
  }
  return saida;
}

/** Base64 de UTF-8, igual no Node e no navegador. */
function base64Utf8(texto: string): string {
  let binario = '';
  for (const b of new TextEncoder().encode(texto)) binario += String.fromCharCode(b);
  return btoa(binario);
}

/**
 * A aba Authorization vira header (ou query) — com os segredos JÁ trocados
 * (`semCofre`) e os `{{ }}` resolvidos. Um header de mesmo nome escrito à mão
 * na aba Headers vale mais: quem o escreveu quis aquele.
 */
export function aplicarAutorizacao(req: RequisicaoHttp): RequisicaoHttp {
  const a = req.autorizacao;
  const semAuth: RequisicaoHttp = { ...req, autorizacao: { tipo: 'nenhuma' } };
  const comHeader = (chave: string, valor: string): RequisicaoHttp => {
    const jaTem = req.headers.some((h) => h.ligado && h.chave.trim().toLowerCase() === chave.toLowerCase());
    return jaTem ? semAuth : { ...semAuth, headers: [...req.headers, { ligado: true, chave, valor, descricao: '' }] };
  };
  switch (a.tipo) {
    case 'bearer': {
      const token = textoDoCampo(a.token);
      return token === '' ? semAuth : comHeader('Authorization', `Bearer ${token}`);
    }
    case 'basic':
      return comHeader('Authorization', `Basic ${base64Utf8(`${a.usuario}:${textoDoCampo(a.senha)}`)}`);
    case 'apikey': {
      if (a.chave.trim() === '') return semAuth;
      const valor = textoDoCampo(a.valor);
      if (a.onde === 'header') return comHeader(a.chave.trim(), valor);
      const { base, query, fragmento } = partirUrl(req.url);
      const par = `${encodeURIComponent(a.chave.trim())}=${encodeURIComponent(valor)}`;
      return { ...semAuth, url: `${base}?${query === null || query === '' ? '' : `${query}&`}${par}${fragmento}` };
    }
    default:
      return semAuth;
  }
}

export function contentTypeDoRaw(formato: FormatoRaw): string {
  switch (formato) {
    case 'json': return 'application/json';
    case 'xml': return 'application/xml';
    case 'html': return 'text/html';
    default: return 'text/plain';
  }
}

// ---------------------------------------------------------------------------
// A resposta como variável
// ---------------------------------------------------------------------------

export interface RespostaComoVariavel {
  readonly status: number;
  readonly statusTexto: string;
  /** Nomes em minúsculas; repetidos (set-cookie) juntos por ", ". */
  readonly headers: Readonly<Record<string, string>>;
  /** JSON já lido; texto como texto; binário em base64. */
  readonly body: unknown;
  readonly tempo: number;
  readonly tamanho: number;
  readonly url: string;
}

export const ehJson = (tipoDeConteudo: string): boolean =>
  /^application\/(?:[\w.-]+\+)?json\b/i.test(tipoDeConteudo.trim()) || /\+json\b/i.test(tipoDeConteudo);

/** O que a célula seguinte recebe pelo nome da célula HTTP (decisão dele, 28/10). */
export function valorDaVariavel(r: SaidaHttp): RespostaComoVariavel {
  const headers: Record<string, string> = {};
  for (const [k, v] of r.headers) {
    const chave = k.toLowerCase();
    headers[chave] = headers[chave] === undefined ? v : `${headers[chave]}, ${v}`;
  }
  let body: unknown = r.corpo;
  if (r.codificacao === 'texto' && ehJson(r.tipoDeConteudo)) {
    try {
      body = JSON.parse(r.corpo);
    } catch {
      // Diz que é JSON e não é: entrega o texto, que é o que chegou.
    }
  }
  return { status: r.status, statusTexto: r.statusTexto, headers, body, tempo: r.tempoMs, tamanho: r.tamanho, url: r.url };
}

// ---------------------------------------------------------------------------
// Ler do arquivo
// ---------------------------------------------------------------------------

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const comoTexto = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

function lerLinha(v: unknown): LinhaHttp | null {
  if (!ehObjeto(v)) return null;
  return { ligado: v.ligado !== false, chave: comoTexto(v.chave), valor: comoTexto(v.valor), descricao: comoTexto(v.descricao) };
}

function lerLinhas(v: unknown): LinhaHttp[] {
  return (Array.isArray(v) ? v : []).map(lerLinha).filter((l): l is LinhaHttp => l !== null);
}

function lerCorpo(v: unknown): CorpoHttp {
  if (!ehObjeto(v)) return { tipo: 'nenhum' };
  switch (v.tipo) {
    case 'form-data':
      return {
        tipo: 'form-data',
        campos: (Array.isArray(v.campos) ? v.campos : []).flatMap((c): CampoDeFormulario[] => {
          const l = lerLinha(c);
          return l === null ? [] : [{ ...l, tipo: ehObjeto(c) && c.tipo === 'arquivo' ? 'arquivo' : 'texto' }];
        }),
      };
    case 'urlencoded':
      return { tipo: 'urlencoded', campos: lerLinhas(v.campos) };
    case 'raw':
      return {
        tipo: 'raw',
        formato: FORMATOS_RAW.includes(v.formato as FormatoRaw) ? (v.formato as FormatoRaw) : 'texto',
        texto: comoTexto(v.texto),
      };
    case 'binario':
      return { tipo: 'binario', arquivo: comoTexto(v.arquivo) };
    default:
      return { tipo: 'nenhum' };
  }
}

function lerCampoSecreto(v: unknown): CampoSecreto {
  if (ehObjeto(v) && typeof v.cofre === 'string' && REFERENCIA_DO_COFRE.test(v.cofre)) return { cofre: v.cofre };
  return { texto: ehObjeto(v) ? comoTexto(v.texto) : '' };
}

function lerAutorizacao(v: unknown): AutorizacaoHttp {
  if (!ehObjeto(v)) return { tipo: 'nenhuma' };
  switch (v.tipo) {
    case 'bearer': return { tipo: 'bearer', token: lerCampoSecreto(v.token) };
    case 'basic': return { tipo: 'basic', usuario: comoTexto(v.usuario), senha: lerCampoSecreto(v.senha) };
    case 'apikey':
      return {
        tipo: 'apikey', chave: comoTexto(v.chave), valor: lerCampoSecreto(v.valor), onde: v.onde === 'query' ? 'query' : 'header',
      };
    case 'oauth2': {
      const base = oauthVazio(typeof v.tokens === 'string' && REFERENCIA_DO_COFRE.test(v.tokens) ? v.tokens : '');
      const texto = (campo: unknown, padrao: string) => (campo === undefined ? padrao : comoTexto(campo));
      return {
        ...base,
        fluxo: FLUXOS_OAUTH.includes(v.fluxo as FluxoOAuth) ? (v.fluxo as FluxoOAuth) : base.fluxo,
        urlDoToken: texto(v.urlDoToken, ''), urlDeAutorizacao: texto(v.urlDeAutorizacao, ''),
        urlDeRetorno: texto(v.urlDeRetorno, base.urlDeRetorno), clientId: texto(v.clientId, ''),
        clientSecret: lerCampoSecreto(v.clientSecret), escopo: texto(v.escopo, ''), usuario: texto(v.usuario, ''),
        senha: lerCampoSecreto(v.senha), pkce: v.pkce !== false, credenciaisNo: v.credenciaisNo === 'corpo' ? 'corpo' : 'basic',
      };
    }
    default: return { tipo: 'nenhuma' };
  }
}

function lerOpcoes(v: unknown): OpcoesHttp {
  const p = opcoesPadrao();
  if (!ehObjeto(v)) return p;
  return {
    timeoutMs: typeof v.timeoutMs === 'number' && Number.isFinite(v.timeoutMs) && v.timeoutMs > 0 ? Math.round(v.timeoutMs) : 0,
    seguirRedirecionamentos: typeof v.seguirRedirecionamentos === 'boolean' ? v.seguirRedirecionamentos : p.seguirRedirecionamentos,
    ignorarCertificado: v.ignorarCertificado === true,
    proxy: typeof v.proxy === 'string' ? v.proxy.trim() : '',
  };
}

/** Do `.brnb`: confere campo a campo; o que não presta vira o padrão. */
export function lerRequisicao(v: unknown): RequisicaoHttp {
  if (!ehObjeto(v)) return requisicaoVazia();
  return {
    metodo: METODOS_HTTP.includes(v.metodo as MetodoHttp) ? (v.metodo as MetodoHttp) : 'GET',
    url: comoTexto(v.url),
    params: lerLinhas(v.params),
    headers: lerLinhas(v.headers),
    autorizacao: lerAutorizacao(v.autorizacao),
    corpo: lerCorpo(v.corpo),
    opcoes: lerOpcoes(v.opcoes),
  };
}

export function lerSaidaHttp(v: Record<string, unknown>): SaidaHttp | null {
  if (typeof v.status !== 'number' || typeof v.corpo !== 'string') return null;
  const headers = (Array.isArray(v.headers) ? v.headers : [])
    .filter((h): h is [unknown, unknown] => Array.isArray(h) && h.length === 2)
    .map(([k, valor]) => [comoTexto(k), comoTexto(valor)] as const);
  return {
    tipo: 'http',
    status: v.status,
    statusTexto: comoTexto(v.statusTexto),
    tempoMs: typeof v.tempoMs === 'number' ? v.tempoMs : 0,
    tamanho: typeof v.tamanho === 'number' ? v.tamanho : v.corpo.length,
    url: comoTexto(v.url),
    headers,
    tipoDeConteudo: comoTexto(v.tipoDeConteudo),
    corpo: v.corpo,
    codificacao: v.codificacao === 'base64' ? 'base64' : 'texto',
    truncado: v.truncado === true,
  };
}
