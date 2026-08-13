// Guarda de rede: a dev-ide executa código arbitrário e guarda credenciais de
// conexão, então o servidor só pode ser falado por um cliente local.
//
// Bind em 127.0.0.1 impede acesso pela rede, mas não impede DNS rebinding — um
// site externo pode apontar um domínio próprio para 127.0.0.1 e falar com a API
// pelo navegador do usuário. Nesse ataque o cabeçalho `Host` carrega o domínio
// do atacante, e o `Origin` (quando presente) também. Por isso os dois são
// verificados aqui.
import { NextFunction, Request, Response } from 'express';

/** Nomes que representam a própria máquina. Comparação exata: "localhost.evil.com" não entra. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const PORT_SUFFIX_RE = /^:\d+$/;

export interface RequestOrigin {
  host?: string;
  origin?: string;
}

/**
 * Extrai o hostname de um cabeçalho `Host`, aceitando IPv6 entre colchetes.
 * Devolve `null` se o cabeçalho estiver ausente ou malformado.
 */
function extractHostname(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return null;

  const [name, rest] =
    value.startsWith('[')
      ? splitAt(value, value.indexOf(']') + 1)
      : splitAt(value, indexOrEnd(value, ':'));

  if (name.length === 0) return null;
  if (rest.length > 0 && !PORT_SUFFIX_RE.test(rest)) return null;
  return name;
}

function splitAt(value: string, index: number): [string, string] {
  if (index <= 0) return ['', value];
  return [value.slice(0, index), value.slice(index)];
}

function indexOrEnd(value: string, char: string): number {
  const index = value.indexOf(char);
  return index === -1 ? value.length : index;
}

function isLoopbackOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // inclui o Origin literal "null" de iframes sandbox e file://
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

/** Decide se a requisição veio de um cliente local. Função pura, para ser testável. */
export function isAllowedRequest({ host, origin }: RequestOrigin): boolean {
  if (host === undefined) return false;
  const hostname = extractHostname(host);
  if (hostname === null || !LOOPBACK_HOSTNAMES.has(hostname)) return false;

  // Origin ausente é normal em navegação direta, curl e GETs same-origin.
  // Presente, precisa ser local — é o que barra um site externo.
  return origin === undefined || isLoopbackOrigin(origin);
}

/** Middleware Express que aplica {@link isAllowedRequest}. Deve vir antes de qualquer rota. */
export function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  if (isAllowedRequest({ host: req.headers.host, origin: req.headers.origin })) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    data: null,
    error: 'A dev-ide só aceita requisições locais (localhost).',
  });
}
