// A célula HTTP do notebook sai daqui, do MOTOR (spec 120, etapas 1 e 3).
//
// Do motor e não da webview: sem CORS, e uma URL da rede interna funciona como
// no Postman. Pelo `node:http`/`node:https`, e não pelo `fetch`: as próximas
// etapas precisam do que o `fetch` não dá sem pacote extra — ignorar
// certificado inválido, proxy, decidir cada redirecionamento.
//
// O corpo multipart é montado pelo próprio Node (`FormData` → `Response`): a
// fronteira e os cabeçalhos de cada parte ficam do jeito que os servidores
// esperam, sem conta feita à mão.
import type { IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import {
  contentTypeDoRaw, ehJson, SAIDA_HTTP_MAX_BYTES, type RequisicaoHttp, type SaidaHttp,
} from '../../shared/notebook/http';
import type { PoteDeCookies } from './cookies-http';
import { umaIda } from './ida-http';
import { proxyPara, type Ambiente } from './proxy-http';

export interface OpcoesDeEnvio {
  /** O Parar da célula. */
  readonly sinal?: AbortSignal;
  readonly maxRedirecionamentos?: number;
  /** Headers que não seguem um redirecionamento para outra origem (a API Key no header). */
  readonly headersSensiveis?: readonly string[];
  /** De onde vem o proxy do sistema (`HTTP_PROXY`…). Padrão: o do motor. */
  readonly ambiente?: Ambiente;
  /** O pote do notebook (etapa 3): manda o que tem para o host, guarda o que chegar. */
  readonly cookies?: PoteDeCookies;
}

export interface RespostaCompleta {
  readonly status: number;
  readonly statusTexto: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly tipoDeConteudo: string;
  /** Inteiro e já descomprimido. */
  readonly corpo: Buffer;
  readonly tamanho: number;
  readonly tempoMs: number;
  /** A final, depois dos redirecionamentos. */
  readonly url: string;
}

interface CorpoPronto {
  readonly bytes: Buffer | null;
  readonly tipo: string | null;
}

async function lerArquivo(caminho: string, onde: string): Promise<Buffer> {
  if (caminho.trim() === '') throw new Error(`${onde}: escolha o arquivo (caminho absoluto).`);
  try {
    return await readFile(caminho);
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    throw new Error(`${onde}: ${codigo === 'ENOENT' ? 'arquivo não encontrado' : 'não deu para ler'}: ${caminho}`);
  }
}

async function montarCorpo(req: RequisicaoHttp): Promise<CorpoPronto> {
  const c = req.corpo;
  switch (c.tipo) {
    case 'raw':
      return { bytes: Buffer.from(c.texto, 'utf8'), tipo: contentTypeDoRaw(c.formato) };
    case 'urlencoded':
      return {
        bytes: Buffer.from(new URLSearchParams(c.campos.map((l) => [l.chave, l.valor])).toString(), 'utf8'),
        tipo: 'application/x-www-form-urlencoded',
      };
    case 'binario':
      return { bytes: await lerArquivo(c.arquivo, 'binary'), tipo: 'application/octet-stream' };
    case 'form-data': {
      const fd = new FormData();
      for (const campo of c.campos) {
        if (campo.tipo === 'arquivo') {
          const bytes = await lerArquivo(campo.valor, `form-data "${campo.chave}"`);
          fd.append(campo.chave, new Blob([new Uint8Array(bytes)]), path.basename(campo.valor));
        } else {
          fd.append(campo.chave, campo.valor);
        }
      }
      const r = new Response(fd);
      return { bytes: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') };
    }
    default:
      return { bytes: null, tipo: null };
  }
}

/** Sem esquema, http:// — o que o Postman faz. */
function urlDe(texto: string): URL {
  const t = texto.trim();
  if (t === '') throw new Error('Escreva a URL da requisição.');
  const comEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  try {
    const url = new URL(comEsquema);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`só http:// e https://, não ${url.protocol}`);
    }
    return url;
  } catch (e) {
    throw new Error(`URL inválida: ${t} (${e instanceof Error ? e.message : String(e)})`);
  }
}

/**
 * O maior corpo que o motor aceita, já descomprimido. Sem teto, uma resposta
 * de 300 KB que abre em gigabytes (bomba de descompressão) derrubaria o motor
 * — e com ele a IDE inteira.
 */
export const MAX_CORPO_DA_RESPOSTA = 256 * 1024 * 1024;
const grandeDemais = () =>
  new Error(`Resposta grande demais: passa de ${MAX_CORPO_DA_RESPOSTA / 1024 / 1024} MB. Use um endereço que devolva menos.`);

function umaCamada(corpo: Buffer, codificacao: string): Buffer {
  const teto = { maxOutputLength: MAX_CORPO_DA_RESPOSTA };
  try {
    switch (codificacao) {
      case 'gzip': case 'x-gzip': return gunzipSync(corpo, teto);
      case 'br': return brotliDecompressSync(corpo, teto);
      case 'deflate':
        // Há servidor que manda deflate "cru", sem o cabeçalho zlib.
        try { return inflateSync(corpo, teto); } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw e;
          return inflateRawSync(corpo, teto);
        }
      default: return corpo;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) throw grandeDemais();
    throw new Error(`A resposta diz "${codificacao}" e não abriu: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** `Content-Encoding: gzip, br` foi aplicado nessa ordem: desfaz do fim para o começo. */
function descomprimir(corpo: Buffer, codificacao: string | undefined): Buffer {
  if (corpo.length === 0) return corpo;
  const camadas = (codificacao ?? '').split(',').map((c) => c.trim().toLowerCase()).filter((c) => c !== '' && c !== 'identity');
  return camadas.reduceRight(umaCamada, corpo);
}

function paresDe(res: IncomingMessage): [string, string][] {
  const pares: [string, string][] = [];
  for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) pares.push([res.rawHeaders[i].toLowerCase(), res.rawHeaders[i + 1]]);
  return pares;
}

const temHeader = (headers: Record<string, string>, nome: string): boolean =>
  Object.keys(headers).some((k) => k.toLowerCase() === nome);

const tirar = (headers: Record<string, string>, nomes: readonly string[]): void => {
  for (const k of Object.keys(headers)) if (nomes.includes(k.toLowerCase())) delete headers[k];
};

/**
 * O Parar e o timeout num sinal só. Saber QUAL dos dois disparou é o que faz o
 * recado dizer "Tempo esgotado" em vez de "cancelada".
 */
function sinalDaIda(sinal: AbortSignal | undefined, timeoutMs: number): {
  sinal: AbortSignal; porTempo: () => boolean; fim: () => void;
} {
  const controle = new AbortController();
  let estourou = false;
  const parar = () => controle.abort();
  if (sinal?.aborted) controle.abort();
  sinal?.addEventListener('abort', parar, { once: true });
  const relogio = timeoutMs > 0 ? setTimeout(() => { estourou = true; controle.abort(); }, timeoutMs) : null;
  return {
    sinal: controle.signal,
    porTempo: () => estourou,
    fim: () => {
      if (relogio !== null) clearTimeout(relogio);
      sinal?.removeEventListener('abort', parar);
    },
  };
}

/** Manda a requisição JÁ RESOLVIDA (`{{ }}` trocados, linhas desligadas fora). */
export async function enviarRequisicao(req: RequisicaoHttp, opcoes: OpcoesDeEnvio): Promise<RespostaCompleta> {
  let url = urlDe(req.url);
  const corpo = await montarCorpo(req);
  const headers: Record<string, string> = {};
  for (const h of req.headers) {
    const nome = h.chave.trim();
    // O tamanho é do motor: um Content-Length errado à mão corta ou trava o envio.
    if (nome === '' || nome.toLowerCase() === 'content-length') continue;
    // A mesma chave em outra caixa: vale a de baixo, como uma linha só.
    tirar(headers, [nome.toLowerCase()]);
    headers[nome] = h.valor;
  }
  // Os padrões do Postman, só onde ele não escreveu o seu.
  if (!temHeader(headers, 'user-agent')) headers['User-Agent'] = 'BraytechCode';
  if (!temHeader(headers, 'accept')) headers.Accept = '*/*';
  if (!temHeader(headers, 'accept-encoding')) headers['Accept-Encoding'] = 'gzip, deflate, br';
  if (corpo.tipo !== null && !temHeader(headers, 'content-type')) headers['Content-Type'] = corpo.tipo;
  // O Cookie escrito à mão vale mais que o pote (etapa 3).
  const cookieDaMao = temHeader(headers, 'cookie');

  const o = req.opcoes;
  const ambiente = opcoes.ambiente ?? process.env;
  let metodo: string = req.metodo;
  let bytes = corpo.bytes;
  const max = o.seguirRedirecionamentos ? (opcoes.maxRedirecionamentos ?? 10) : 0;
  const controle = sinalDaIda(opcoes.sinal, o.timeoutMs);
  const inicio = performance.now();
  try {
    for (let saltos = 0; ; saltos += 1) {
      if (controle.sinal.aborted) throw new Error('Requisição cancelada.');
      const doPote = cookieDaMao ? null : opcoes.cookies?.cabecalho(url) ?? null;
      const daIda: Record<string, string> = { ...headers };
      if (doPote !== null) daIda.Cookie = doPote;
      if (bytes !== null) daIda['Content-Length'] = String(bytes.length);
      const { res, corpo: bruto } = await umaIda({
        url, metodo, headers: daIda, corpo: bytes, sinal: controle.sinal, ignorarCertificado: o.ignorarCertificado,
        proxy: proxyPara(url, o.proxy, ambiente), maxCorpo: MAX_CORPO_DA_RESPOSTA, grandeDemais,
      });
      // Cada salto guarda o que recebeu: o login que põe a sessão e redireciona.
      const setCookie = res.headers['set-cookie'];
      if (setCookie !== undefined) opcoes.cookies?.guardar(url, setCookie);
      const status = res.statusCode ?? 0;
      const destino = res.headers.location;
      if (status >= 300 && status < 400 && destino !== undefined && saltos < max) {
        const anterior = url;
        url = new URL(destino, url);
        // Outra origem: credencial não vai junto (o que o curl e o navegador fazem).
        if (url.origin !== anterior.origin) {
          tirar(headers, ['authorization', 'cookie', 'proxy-authorization', 'host', ...(opcoes.headersSensiveis ?? [])]);
        }
        // 301/302/303 viram GET sem corpo (o que navegador e Postman fazem); 307/308 repetem igual.
        if (status === 303 || ((status === 301 || status === 302) && metodo !== 'HEAD')) {
          metodo = metodo === 'HEAD' ? 'HEAD' : 'GET';
          bytes = null;
          tirar(headers, ['content-type']);
        }
        continue;
      }
      const pronto = descomprimir(bruto, res.headers['content-encoding']);
      return {
        status,
        statusTexto: res.statusMessage ?? '',
        headers: paresDe(res),
        tipoDeConteudo: res.headers['content-type'] ?? '',
        corpo: pronto,
        tamanho: pronto.length,
        tempoMs: Math.round(performance.now() - inicio),
        url: url.toString(),
      };
    }
  } catch (e) {
    if (controle.porTempo()) {
      throw new Error(`Tempo esgotado (${o.timeoutMs} ms): ${url.host} não respondeu a tempo. O limite fica na aba Settings.`);
    }
    throw e;
  } finally {
    controle.fim();
  }
}

/** Texto ou binário? Pelo Content-Type; sem ele, pelo conteúdo. */
function ehTexto(tipo: string, corpo: Buffer): boolean {
  const t = tipo.toLowerCase();
  if (t !== '') {
    return t.startsWith('text/') || ehJson(t) || /xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv/.test(t);
  }
  const amostra = corpo.subarray(0, 4096);
  if (amostra.includes(0)) return false;
  // `stream`: um caractere partido no FIM da amostra fica esperando o resto, em
  // vez de contar como inválido; um byte inválido no meio continua erro.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(amostra, { stream: amostra.length < corpo.length });
    return true;
  } catch {
    return false;
  }
}

function decodificar(bytes: Buffer, tipo: string): string {
  const charset = /charset=([^;]+)/i.exec(tipo)?.[1]?.trim().replace(/^"|"$/g, '') ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * A resposta como fica guardada no `.brnb`: o corpo até `max` bytes. O kernel
 * recebe a INTEIRA (`max = Infinity`).
 */
export function comoSaida(r: RespostaCompleta, max: number = SAIDA_HTTP_MAX_BYTES): SaidaHttp {
  const texto = ehTexto(r.tipoDeConteudo, r.corpo);
  const truncado = r.corpo.length > max;
  const bytes = truncado ? r.corpo.subarray(0, max) : r.corpo;
  return {
    tipo: 'http',
    status: r.status,
    statusTexto: r.statusTexto,
    tempoMs: r.tempoMs,
    tamanho: r.tamanho,
    url: r.url,
    headers: r.headers,
    tipoDeConteudo: r.tipoDeConteudo,
    corpo: texto ? decodificar(bytes, r.tipoDeConteudo) : bytes.toString('base64'),
    codificacao: texto ? 'texto' : 'base64',
    truncado,
  };
}
