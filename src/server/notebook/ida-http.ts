// UMA ida e volta da célula HTTP (spec 120): direto, por um proxy http, ou
// por um túnel CONNECT quando o destino é https (etapa 3). Sem seguir
// redirecionamento — quem decide isso é `requisicao-http.ts`.
//
// O certificado é conferido sempre, inclusive dentro do túnel; "Ignorar
// certificado inválido" (aba Settings) desliga a conferência — para o
// servidor interno com certificado próprio.
import { request as requestHttp, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP, type Socket } from 'node:net';
import { connect as conectarTls } from 'node:tls';

export interface Ida {
  readonly url: URL;
  readonly metodo: string;
  readonly headers: OutgoingHttpHeaders;
  readonly corpo: Buffer | null;
  readonly sinal: AbortSignal;
  readonly ignorarCertificado: boolean;
  /** `null` = direto. */
  readonly proxy: URL | null;
  /** O teto do corpo da resposta; passou, a ida é cortada. */
  readonly maxCorpo: number;
  readonly grandeDemais: () => Error;
}

export interface Volta {
  readonly res: IncomingMessage;
  readonly corpo: Buffer;
}

const ehErroDeCertificado = (e: NodeJS.ErrnoException): boolean =>
  /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS_CERT/i.test(e.code ?? '') || /certificate/i.test(e.message);

/** O recado do erro, dizendo ONDE falhou: no proxy, no certificado ou no destino. */
function recado(e: NodeJS.ErrnoException, ida: Ida, noProxy: boolean): Error {
  if (e.name === 'AbortError') return new Error('Requisição cancelada.');
  if (ehErroDeCertificado(e)) {
    return new Error(
      `${ida.url.host}: certificado inválido (${e.message}). Se o servidor é seu, marque "Ignorar certificado ` +
        'inválido" na aba Settings.'
    );
  }
  const onde = noProxy && ida.proxy !== null ? `proxy ${ida.proxy.host}` : ida.url.host;
  return new Error(`${onde}: ${e.code ?? ''} ${e.message}`.replace(/\s+/g, ' ').trim());
}

/** `Proxy-Authorization` quando o proxy tem usuário e senha na URL (`http://u:s@proxy:3128`). */
function autorizacaoDoProxy(proxy: URL): OutgoingHttpHeaders {
  if (proxy.username === '') return {};
  const credencial = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { 'Proxy-Authorization': `Basic ${Buffer.from(credencial).toString('base64')}` };
}

const semColchete = (host: string): string => host.replace(/^\[|\]$/g, '');

/** A URL sem `usuario:senha@`: pelo proxy ela vai inteira no caminho, e o proxy não precisa ver a senha. */
function semCredencial(url: URL): string {
  const limpa = new URL(url.href);
  limpa.username = '';
  limpa.password = '';
  return limpa.href;
}

/** O `usuario:senha@` da URL vira Basic, como o Node faz na ida direta (se não houver Authorization). */
function credencialDaUrl(url: URL, headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  if (url.username === '' || Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) return {};
  const par = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return { Authorization: `Basic ${Buffer.from(par).toString('base64')}` };
}

/** Abre o túnel CONNECT até o destino https. */
function abrirTunel(ida: Ida, proxy: URL): Promise<Socket> {
  return new Promise((resolver, rejeitar) => {
    const alvo = `${ida.url.hostname}:${ida.url.port || '443'}`;
    const pedido = requestHttp({
      host: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: alvo, signal: ida.sinal,
      headers: { Host: alvo, ...autorizacaoDoProxy(proxy) },
    });
    pedido.on('connect', (res, socket) => {
      if (res.statusCode === 200) {
        resolver(socket);
        return;
      }
      socket.destroy();
      rejeitar(new Error(`proxy ${proxy.host} recusou o túnel para ${alvo}: ${res.statusCode} ${res.statusMessage ?? ''}`.trim()));
    });
    pedido.on('error', (e: NodeJS.ErrnoException) => rejeitar(recado(e, ida, true)));
    pedido.end();
  });
}

export async function umaIda(ida: Ida): Promise<Volta> {
  const { url, proxy } = ida;
  const https = url.protocol === 'https:';
  const rejectUnauthorized = !ida.ignorarCertificado;
  const tunel = proxy !== null && https ? await abrirTunel(ida, proxy) : null;

  return new Promise((resolver, rejeitar) => {
    const aoResponder = (res: IncomingMessage): void => {
      const pedacos: Buffer[] = [];
      let recebidos = 0;
      res.on('data', (p: Buffer) => {
        recebidos += p.length;
        if (recebidos > ida.maxCorpo) {
          pedido.destroy();
          rejeitar(ida.grandeDemais());
          return;
        }
        pedacos.push(p);
      });
      res.on('end', () => resolver({ res, corpo: Buffer.concat(pedacos) }));
      res.on('error', (e: NodeJS.ErrnoException) => rejeitar(recado(e, ida, false)));
    };
    const comum = { method: ida.metodo, signal: ida.sinal };
    const pedido = tunel !== null
      // https dentro do túnel: o TLS é com o DESTINO (SNI só para nome, não para IP).
      ? requestHttps(url, {
        ...comum, headers: ida.headers, rejectUnauthorized,
        // `host`: o certificado é conferido contra o DESTINO, e não contra o
        // proxy (sem ele, um https://IP pelo túnel nunca passaria).
        createConnection: () => conectarTls({
          socket: tunel, rejectUnauthorized, host: semColchete(url.hostname),
          ...(isIP(semColchete(url.hostname)) === 0 ? { servername: url.hostname } : {}),
        }),
      }, aoResponder)
      : proxy !== null
        // http por proxy: a URL inteira no lugar do caminho.
        ? requestHttp({
          ...comum, host: proxy.hostname, port: proxy.port || 80, path: semCredencial(url),
          headers: { ...credencialDaUrl(url, ida.headers), ...ida.headers, Host: url.host, ...autorizacaoDoProxy(proxy) },
        }, aoResponder)
        : https
          ? requestHttps(url, { ...comum, headers: ida.headers, rejectUnauthorized }, aoResponder)
          : requestHttp(url, { ...comum, headers: ida.headers }, aoResponder);
    pedido.on('error', (e: NodeJS.ErrnoException) => {
      tunel?.destroy();
      rejeitar(recado(e, ida, proxy !== null && tunel === null));
    });
    if (ida.corpo !== null) pedido.write(ida.corpo);
    pedido.end();
  });
}
