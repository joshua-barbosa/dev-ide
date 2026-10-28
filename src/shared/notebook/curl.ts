// cURL ⇄ célula HTTP (spec 120, etapa 3).
//
// Importar: o que o navegador ("Copy as cURL"), a documentação de uma API ou
// um colega mandam. Os dois sabores do "Copy as cURL" do Chrome entram — o de
// bash e o de cmd (`^"`, `^` no fim da linha), porque Windows é uso real aqui.
// Flag que não conhecemos vira AVISO: o resto importa.
//
// Um `Authorization: Bearer …`/`Basic …` vai para a aba Authorization, e não
// para Headers: lá o segredo vai ao cofre, e não fica no `.brnb` (decisão de
// 28/10 de guardar segredo no cofre).
//
// Copiar: bash (aspas simples) ou cmd (aspas duplas e `^`).
import {
  aoEditarUrl, contentTypeDoRaw, linhaVazia, partirUrl, requisicaoVazia,
  type AutorizacaoHttp, type CampoDeFormulario, type CorpoHttp, type FormatoRaw, type LinhaHttp,
  type MetodoHttp, type OpcoesHttp, type RequisicaoHttp, METODOS_HTTP,
} from './http';

// ---------------------------------------------------------------------------
// Ler
// ---------------------------------------------------------------------------

/** O "Copy as cURL (cmd)": `^` escapa o caractere seguinte; `^` no fim da linha continua. */
function desfazerCmd(texto: string): string {
  return texto.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
}

/**
 * Separa em palavras pelas regras do C do Windows (as do curl.exe): `2n`
 * barras + aspa = `n` barras e a aspa abre/fecha; `2n+1` = `n` barras e uma
 * aspa literal; barra sem aspa depois é só barra.
 */
function palavrasDoWindows(texto: string): string[] {
  const saida: string[] = [];
  let atual = '';
  let tem = false;
  let dentro = false;
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === '\\') {
      let n = 0;
      while (texto[i + n] === '\\') n += 1;
      if (texto[i + n] === '"') {
        atual += '\\'.repeat(Math.floor(n / 2));
        if (n % 2 === 1) {
          atual += '"';
          i += n + 1;
        } else {
          i += n;
        }
      } else {
        atual += '\\'.repeat(n);
        i += n;
      }
      tem = true;
    } else if (c === '"') {
      dentro = !dentro;
      tem = true;
      i += 1;
    } else if (!dentro && /\s/.test(c)) {
      if (tem) saida.push(atual);
      atual = '';
      tem = false;
      i += 1;
    } else {
      atual += c;
      tem = true;
      i += 1;
    }
  }
  if (tem) saida.push(atual);
  return saida;
}

/** Separa em palavras como o bash: aspas simples, duplas, `$'…'` e `\`. */
function palavras(texto: string): string[] {
  const saida: string[] = [];
  let atual = '';
  let tem = false;
  let i = 0;
  const fim = () => {
    if (tem) saida.push(atual);
    atual = '';
    tem = false;
  };
  while (i < texto.length) {
    const c = texto[i];
    if (c === '\\' && (texto[i + 1] === '\n' || (texto[i + 1] === '\r' && texto[i + 2] === '\n'))) {
      i += texto[i + 1] === '\r' ? 3 : 2;
    } else if (/\s/.test(c)) {
      fim();
      i += 1;
    } else if (c === "'") {
      const f = texto.indexOf("'", i + 1);
      if (f === -1) throw new Error('Aspas simples sem fechar no cURL.');
      atual += texto.slice(i + 1, f);
      tem = true;
      i = f + 1;
    } else if (c === '$' && texto[i + 1] === "'") {
      // $'…' do bash: \n, \t, \' e \\ dentro.
      i += 2;
      while (i < texto.length && texto[i] !== "'") {
        if (texto[i] === '\\' && i + 1 < texto.length) {
          const e = texto[i + 1];
          atual += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          i += 2;
        } else {
          atual += texto[i];
          i += 1;
        }
      }
      tem = true;
      i += 1;
    } else if (c === '"') {
      i += 1;
      while (i < texto.length && texto[i] !== '"') {
        if (texto[i] === '\\' && '"\\$`'.includes(texto[i + 1] ?? '')) {
          atual += texto[i + 1];
          i += 2;
        } else {
          atual += texto[i];
          i += 1;
        }
      }
      if (i >= texto.length) throw new Error('Aspas duplas sem fechar no cURL.');
      tem = true;
      i += 1;
    } else if (c === '\\' && i + 1 < texto.length) {
      atual += texto[i + 1];
      tem = true;
      i += 2;
    } else {
      atual += c;
      tem = true;
      i += 1;
    }
  }
  fim();
  return saida;
}

/** Flags que pedem valor (forma curta e longa). */
const COM_VALOR = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-ascii', '--data-raw', '--data-binary',
  '--data-urlencode', '--json', '-F', '--form', '--form-string', '-u', '--user', '-m', '--max-time', '-x', '--proxy',
  '-b', '--cookie', '-A', '--user-agent', '-e', '--referer', '--url', '-o', '--output', '--connect-timeout',
  '-w', '--write-out', '--retry', '-T', '--upload-file', '-c', '--cookie-jar',
]);
/** Flags sem valor que só mudam a saída do próprio cURL: em silêncio. */
const IGNORADAS = new Set(['-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include', '--compressed', '-f', '--fail', '-#', '--progress-bar', '-N', '--no-buffer']);
/** Flags de valor que não fazem sentido aqui: em silêncio também. */
const IGNORADAS_COM_VALOR = new Set(['-o', '--output', '-w', '--write-out', '--connect-timeout', '-c', '--cookie-jar']);
const LETRAS_SEM_VALOR = new Set(['s', 'S', 'v', 'i', 'L', 'k', 'I', 'G', 'f', 'N', '#']);

interface Lido {
  metodo: string | null;
  url: string | null;
  headers: LinhaHttp[];
  dados: string[];
  dadosUrlencoded: string[];
  binario: string | null;
  json: string | null;
  form: CampoDeFormulario[];
  usuario: string | null;
  opcoes: OpcoesHttp;
  get: boolean;
  head: boolean;
  avisos: string[];
}

const linha = (chave: string, valor: string): LinhaHttp => ({ ...linhaVazia(), chave, valor });

/** `-sSLk` vira `-s -S -L -k`; `-XPOST` vira `-X POST`; `--x=y` vira `--x y`. */
function normalizar(args: readonly string[]): string[] {
  const saida: string[] = [];
  for (const a of args) {
    if (/^--[^=]+=/.test(a)) {
      const igual = a.indexOf('=');
      saida.push(a.slice(0, igual), a.slice(igual + 1));
    } else if (/^-[A-Za-z#]{2,}$/.test(a) && [...a.slice(1)].every((l) => LETRAS_SEM_VALOR.has(l))) {
      for (const l of a.slice(1)) saida.push(`-${l}`);
    } else if (/^-[A-Za-z]./.test(a) && COM_VALOR.has(a.slice(0, 2))) {
      saida.push(a.slice(0, 2), a.slice(2));
    } else {
      saida.push(a);
    }
  }
  return saida;
}

function lerArgumentos(args: readonly string[]): Lido {
  const l: Lido = {
    metodo: null, url: null, headers: [], dados: [], dadosUrlencoded: [], binario: null, json: null, form: [],
    usuario: null, opcoes: { timeoutMs: 0, seguirRedirecionamentos: false, ignorarCertificado: false, proxy: '' },
    get: false, head: false, avisos: [],
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const valor = (): string => {
      i += 1;
      if (i >= args.length) throw new Error(`${a} pede um valor.`);
      return args[i];
    };
    if (!a.startsWith('-') || a === '-') {
      if (l.url === null) l.url = a;
      else l.avisos.push(`Ignorado: "${a}" (o cURL tinha mais de uma URL; ficou a primeira).`);
      continue;
    }
    switch (a) {
      case '-X': case '--request': l.metodo = valor().toUpperCase(); break;
      case '--url': l.url = valor(); break;
      case '-H': case '--header': {
        const h = valor();
        const dois = h.indexOf(':');
        if (dois > 0) l.headers.push(linha(h.slice(0, dois).trim(), h.slice(dois + 1).trim()));
        break;
      }
      case '-d': case '--data': case '--data-ascii': case '--data-raw': l.dados.push(valor()); break;
      case '--data-binary': {
        const v = valor();
        if (v.startsWith('@')) l.binario = v.slice(1);
        else l.dados.push(v);
        break;
      }
      case '--data-urlencode': l.dadosUrlencoded.push(valor()); break;
      case '--json': l.json = valor(); break;
      case '-F': case '--form': case '--form-string': {
        const v = valor();
        const igual = v.indexOf('=');
        const chave = igual === -1 ? v : v.slice(0, igual);
        const resto = igual === -1 ? '' : v.slice(igual + 1);
        const arquivo = a !== '--form-string' && resto.startsWith('@');
        l.form.push({ ...linha(chave, arquivo ? resto.slice(1).split(';')[0] : resto), tipo: arquivo ? 'arquivo' : 'texto' });
        break;
      }
      case '-u': case '--user': l.usuario = valor(); break;
      case '-m': case '--max-time': l.opcoes = { ...l.opcoes, timeoutMs: Math.round(Number(valor()) * 1000) || 0 }; break;
      case '-x': case '--proxy': l.opcoes = { ...l.opcoes, proxy: valor() }; break;
      case '-k': case '--insecure': l.opcoes = { ...l.opcoes, ignorarCertificado: true }; break;
      case '-L': case '--location': l.opcoes = { ...l.opcoes, seguirRedirecionamentos: true }; break;
      case '-b': case '--cookie': l.headers.push(linha('Cookie', valor())); break;
      case '-A': case '--user-agent': l.headers.push(linha('User-Agent', valor())); break;
      case '-e': case '--referer': l.headers.push(linha('Referer', valor())); break;
      case '-G': case '--get': l.get = true; break;
      case '-I': case '--head': l.head = true; break;
      default:
        if (IGNORADAS.has(a)) break;
        if (IGNORADAS_COM_VALOR.has(a)) {
          valor();
          break;
        }
        // Desconhecida: se a próxima não parece flag nem URL, é o valor dela.
        if (COM_VALOR.has(a)) valor();
        l.avisos.push(`Ignorado: ${a} (a célula HTTP não tem equivalente).`);
    }
  }
  return l;
}

/** `a=1&b=2` em linhas, decodificado (`+` é espaço, como num formulário). */
function linhasUrlencoded(dados: readonly string[]): LinhaHttp[] {
  const decodificar = (t: string): string => {
    try {
      return decodeURIComponent(t.replace(/\+/g, ' '));
    } catch {
      return t;
    }
  };
  return dados.flatMap((d) => d.split('&')).filter((p) => p !== '').map((par) => {
    const igual = par.indexOf('=');
    return igual === -1 ? linha(decodificar(par), '') : linha(decodificar(par.slice(0, igual)), decodificar(par.slice(igual + 1)));
  });
}

/** `--data-urlencode`: `k=v` ou só `v`; o valor ainda NÃO está codificado. */
function linhasDoDataUrlencode(dados: readonly string[]): LinhaHttp[] {
  return dados.map((d) => {
    const igual = d.indexOf('=');
    return igual === -1 ? linha('', d) : linha(d.slice(0, igual), d.slice(igual + 1));
  });
}

function formatoDoTipo(tipo: string, dados: string): FormatoRaw | 'urlencoded' {
  const t = tipo.toLowerCase();
  // Sem Content-Type o cURL manda como formulário — mas um `{…}` não é
  // formulário: é o JSON de quem esqueceu o header.
  if (t === '') return /^\s*[[{]/.test(dados) ? 'json' : dados.includes('=') ? 'urlencoded' : 'texto';
  if (t.includes('x-www-form-urlencoded')) return 'urlencoded';
  if (/json/.test(t)) return 'json';
  if (/xml/.test(t)) return 'xml';
  if (/html/.test(t)) return 'html';
  return 'texto';
}

function montarCorpo(l: Lido, tipoDoHeader: string): CorpoHttp {
  if (l.json !== null) return { tipo: 'raw', formato: 'json', texto: l.json };
  if (l.form.length > 0) return { tipo: 'form-data', campos: l.form };
  if (l.binario !== null) return { tipo: 'binario', arquivo: l.binario };
  if (l.dados.length === 0 && l.dadosUrlencoded.length === 0) return { tipo: 'nenhum' };
  const formato = l.dadosUrlencoded.length > 0 ? 'urlencoded' : formatoDoTipo(tipoDoHeader, l.dados.join('&'));
  if (formato === 'urlencoded') {
    return { tipo: 'urlencoded', campos: [...linhasUrlencoded(l.dados), ...linhasDoDataUrlencode(l.dadosUrlencoded)] };
  }
  return { tipo: 'raw', formato, texto: l.dados.join('&') };
}

/** `Authorization: Bearer x` / `Basic b64` → a aba Authorization; o resto continua header. */
function separarAutorizacao(headers: readonly LinhaHttp[], usuario: string | null): {
  headers: LinhaHttp[]; autorizacao: AutorizacaoHttp;
} {
  if (usuario !== null) {
    const dois = usuario.indexOf(':');
    return {
      headers: [...headers],
      autorizacao: { tipo: 'basic', usuario: dois === -1 ? usuario : usuario.slice(0, dois), senha: { texto: dois === -1 ? '' : usuario.slice(dois + 1) } },
    };
  }
  const i = headers.findIndex((h) => h.chave.toLowerCase() === 'authorization');
  if (i === -1) return { headers: [...headers], autorizacao: { tipo: 'nenhuma' } };
  const valor = headers[i].valor;
  const resto = headers.filter((_, j) => j !== i);
  const bearer = /^Bearer\s+(.+)$/i.exec(valor);
  if (bearer !== null) return { headers: resto, autorizacao: { tipo: 'bearer', token: { texto: bearer[1].trim() } } };
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(valor);
  if (basic !== null) {
    try {
      const bytes = Uint8Array.from(atob(basic[1]), (c) => c.charCodeAt(0));
      const claro = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const dois = claro.indexOf(':');
      if (dois !== -1) {
        return { headers: resto, autorizacao: { tipo: 'basic', usuario: claro.slice(0, dois), senha: { texto: claro.slice(dois + 1) } } };
      }
    } catch {
      // Não é base64 de "usuário:senha": fica como header.
    }
  }
  return { headers: [...headers], autorizacao: { tipo: 'nenhuma' } };
}

/** Um comando cURL vira a requisição da célula. Lança se não for cURL ou não tiver URL. */
export function lerCurl(texto: string): { requisicao: RequisicaoHttp; avisos: string[] } {
  const ehCmd = /\^\r?\n|\^"/.test(texto);
  const args = ehCmd ? palavrasDoWindows(desfazerCmd(texto)) : palavras(texto);
  if (args.length === 0 || !/^curl(\.exe)?$/i.test(args[0])) {
    throw new Error('Isto não é um comando cURL (começa com "curl").');
  }
  const l = lerArgumentos(normalizar(args.slice(1)));
  if (l.url === null) throw new Error('O cURL não tem URL.');

  const tipoDoHeader = l.headers.find((h) => h.chave.toLowerCase() === 'content-type')?.valor ?? '';
  let corpo = montarCorpo(l, tipoDoHeader);
  let url = l.url;
  // -G: o que seria corpo vai na query.
  if (l.get && (corpo.tipo === 'urlencoded' || corpo.tipo === 'raw')) {
    const query = corpo.tipo === 'raw' ? corpo.texto
      : corpo.campos.map((c) => `${encodeURIComponent(c.chave)}=${encodeURIComponent(c.valor)}`).join('&');
    const { base, query: antes, fragmento } = partirUrl(url);
    url = `${base}?${antes === null || antes === '' ? '' : `${antes}&`}${query}${fragmento}`;
    corpo = { tipo: 'nenhum' };
  }
  const metodoLido = l.metodo ?? (l.head ? 'HEAD' : l.get ? 'GET' : corpo.tipo !== 'nenhum' ? 'POST' : 'GET');
  const avisos = [...l.avisos];
  let metodo: MetodoHttp = 'GET';
  if (METODOS_HTTP.includes(metodoLido as MetodoHttp)) metodo = metodoLido as MetodoHttp;
  else avisos.push(`Método ${metodoLido} não existe na célula; ficou GET.`);
  if (l.json !== null && !l.headers.some((h) => h.chave.toLowerCase() === 'content-type')) {
    l.headers.push(linha('Content-Type', 'application/json'));
  }
  const { headers, autorizacao } = separarAutorizacao(l.headers, l.usuario);
  const base: RequisicaoHttp = { ...requisicaoVazia(), metodo, headers, autorizacao, corpo, opcoes: l.opcoes };
  return { requisicao: aoEditarUrl(base, url), avisos };
}

// ---------------------------------------------------------------------------
// Copiar
// ---------------------------------------------------------------------------

export type EstiloDeCurl = 'bash' | 'cmd';

/**
 * Aspas do cmd do Windows — o formato do "Copy as cURL (cmd)" do Chrome.
 *
 * São DUAS camadas. O curl.exe separa os argumentos pelas regras do C do
 * Windows: barras antes de aspa (e no fim) dobram, e a aspa vira `\"`. Por
 * cima, o cmd: com `^` antes de TODO especial (inclusive as aspas), o cmd não
 * entra em modo de aspas e não interpreta nada — um valor `x" & calc & "y`
 * vira texto, não comando (achado da revisão de 28/10; o `\"` sozinho deixava
 * o `&` rodar). Quebra de linha não tem escape seguro no cmd: recusada.
 */
function aspasCmd(texto: string): string {
  if (/[\r\n]/.test(texto)) {
    throw new Error(
      'Um valor tem quebra de linha, e o cmd do Windows quebraria o comando ali. Copie em bash (Git Bash, WSL) ' +
        'ou tire a quebra.'
    );
  }
  const doCurl = texto.replace(/(\\*)"/g, (_t, barras: string) => `${barras}${barras}\\"`).replace(/(\\+)$/, '$1$1');
  return `^"${doCurl.replace(/[\^&|<>()%!"]/g, '^$&')}^"`;
}

const aspas = (texto: string, estilo: EstiloDeCurl): string =>
  estilo === 'bash' ? `'${texto.replace(/'/g, "'\\''")}'` : aspasCmd(texto);

/**
 * A requisição como comando cURL. Espera a autorização JÁ aplicada e os
 * segredos trocados (quem chama decide); `{{ }}` vão como estão.
 */
export function paraCurl(req: RequisicaoHttp, estilo: EstiloDeCurl): string {
  const q = (t: string) => aspas(t, estilo);
  const partes: string[] = [];
  const temCorpo = req.corpo.tipo !== 'nenhum';
  const headers = req.headers.filter((h) => h.ligado && h.chave.trim() !== '');
  const temTipo = headers.some((h) => h.chave.toLowerCase() === 'content-type');
  for (const h of headers) partes.push(`-H ${q(`${h.chave}: ${h.valor}`)}`);
  const c = req.corpo;
  switch (c.tipo) {
    case 'raw':
      if (!temTipo) partes.push(`-H ${q(`Content-Type: ${contentTypeDoRaw(c.formato)}`)}`);
      partes.push(`--data-raw ${q(c.texto)}`);
      break;
    case 'urlencoded':
      for (const l of c.campos.filter((x) => x.ligado)) partes.push(`--data-urlencode ${q(`${l.chave}=${l.valor}`)}`);
      break;
    case 'form-data':
      for (const l of c.campos.filter((x) => x.ligado)) {
        partes.push(`-F ${q(`${l.chave}=${l.tipo === 'arquivo' ? '@' : ''}${l.valor}`)}`);
      }
      break;
    case 'binario':
      partes.push(`--data-binary ${q(`@${c.arquivo}`)}`);
      break;
    default:
      break;
  }
  const o = req.opcoes;
  if (o.seguirRedirecionamentos) partes.push('-L');
  if (o.ignorarCertificado) partes.push('-k');
  if (o.timeoutMs > 0) partes.push(`--max-time ${o.timeoutMs / 1000}`);
  if (o.proxy !== '') partes.push(`-x ${q(o.proxy)}`);
  const metodoPadrao = temCorpo ? 'POST' : 'GET';
  const inicio = req.metodo === 'HEAD' ? `curl -I ${q(req.url)}`
    : req.metodo === metodoPadrao && req.metodo === 'GET' ? `curl ${q(req.url)}`
      : `curl -X ${req.metodo} ${q(req.url)}`;
  const quebra = estilo === 'bash' ? ' \\\n  ' : ' ^\n  ';
  return [inicio, ...partes].join(quebra);
}
