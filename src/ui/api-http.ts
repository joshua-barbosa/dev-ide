// O transporte da API da IDE: uma requisição, um envelope, um erro legível.
//
// Saiu de `api.ts` pelo Artigo IV. A separação é a natural: aqui está COMO se
// fala com o servidor, e lá está O QUE se pede a ele.
/**
 * A origem do motor, quando a interface NÃO é servida por ele.
 *
 * Na IDE fica vazia e as rotas seguem relativas, como sempre. Dentro de uma
 * webview do VS Code a origem é `vscode-webview://`, e um `/api/...` relativo
 * bateria no lugar errado — daí a base, definida uma vez na subida (spec 093).
 */
let origem = '';

export function definirBaseDaApi(nova: string): void {
  origem = nova.replace(/\/+$/, '');
}

/** Quem leva o pedido até o motor, quando não é o `fetch` daqui. */
export type Transporte = (metodo: string, url: string, corpo?: unknown) => Promise<unknown>;

let transporte: Transporte | null = null;

/**
 * Troca o `fetch` por outro caminho até o motor (spec 093).
 *
 * Existe por causa da webview do VS Code: a origem dela é `vscode-webview://`,
 * e o motor — de propósito — só aceita `Host`/`Origin` de loopback. O navegador
 * transforma essa recusa num CORS bloqueado, que aparece como "Failed to fetch".
 *
 * A saída NÃO é afrouxar a guarda do motor: é o painel pedir ao host da
 * extensão, que é Node, não tem CORS e já fala com o motor. Assim nada de fora
 * ganha acesso novo — a superfície do motor continua exatamente a mesma.
 */
export function definirTransporte(novo: Transporte | null): void {
  transporte = novo;
}

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (transporte !== null) return (await transporte(method, url, body)) as T;

  let response: Response;
  try {
    response = await fetch(url.startsWith('/') ? `${origem}${url}` : url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha de conexão com o servidor da IDE: ${detalhe}`);
  }

  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
  }

  if (!payload.success) {
    throw new Error(payload.error ?? `Erro do servidor (HTTP ${response.status}).`);
  }
  return payload.data;
}

/** Cada segmento vira um `path=` separado: ids e caminhos podem conter "/". */
export function comCaminho(base: string, nodePath: readonly string[]): string {
  const qs = nodePath.map((p) => `path=${encodeURIComponent(p)}`).join('&');
  return qs === '' ? base : `${base}?${qs}`;
}

