// Por qual proxy a célula HTTP sai (spec 120, etapa 3).
//
// Decisão dele (28/10): o do SISTEMA por padrão — `HTTP_PROXY`, `HTTPS_PROXY`
// e `NO_PROXY`, como o curl e o Postman leem —, e a célula pode apontar um
// próprio. O da célula não olha o `NO_PROXY`: quem o escreveu quis aquele.
//
// Só proxy http:// (o que as redes de empresa usam): https:// e SOCKS pedem
// outra conversa, e falhar com recado é melhor que sair direto calado.

export type Ambiente = Readonly<Record<string, string | undefined>>;

function lerProxy(texto: string): URL {
  const t = texto.trim();
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  let url: URL;
  try {
    url = new URL(comEsquema);
  } catch {
    throw new Error(`Proxy inválido: ${t}`);
  }
  if (url.protocol !== 'http:') {
    throw new Error(`Proxy ${url.protocol}// não é suportado: só proxy http:// (${t}).`);
  }
  return url;
}

const doAmbiente = (env: Ambiente, nome: string): string | undefined =>
  [env[nome.toLowerCase()], env[nome.toUpperCase()]].find((v) => v !== undefined && v.trim() !== '');

/** `host:porta` de um item do NO_PROXY — inclusive IPv6 (`::1`, `[::1]:8080`). */
function hostEPorta(item: string): { h: string; p: string | undefined } {
  const comColchete = /^\[([^\]]+)\](?::(\d+))?$/.exec(item);
  if (comColchete !== null) return { h: comColchete[1], p: comColchete[2] };
  // Mais de um ":" sem colchete é IPv6 sem porta.
  if ((item.match(/:/g) ?? []).length > 1) return { h: item, p: undefined };
  const [h, p] = item.split(':');
  return { h, p };
}

/** O destino está no `NO_PROXY`? */
function semProxy(url: URL, lista: string): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const porta = url.port || (url.protocol === 'https:' ? '443' : '80');
  return lista.split(/[\s,]+/).filter((x) => x !== '').some((item) => {
    if (item === '*') return true;
    const { h, p } = hostEPorta(item.toLowerCase().replace(/^\*?\./, ''));
    if (p !== undefined && p !== porta) return false;
    return host === h || host.endsWith(`.${h}`);
  });
}

/** O proxy para esta URL, ou `null` = direto. */
export function proxyPara(url: URL, daCelula: string, env: Ambiente): URL | null {
  if (daCelula.trim() !== '') return lerProxy(daCelula);
  const doSistema = url.protocol === 'https:'
    ? doAmbiente(env, 'https_proxy') ?? doAmbiente(env, 'http_proxy')
    : doAmbiente(env, 'http_proxy');
  if (doSistema === undefined) return null;
  if (semProxy(url, doAmbiente(env, 'no_proxy') ?? '')) return null;
  return lerProxy(doSistema);
}
