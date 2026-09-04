// O que se vê ao abrir uma chave do Redis.
//
// Ele em 03/09/2026: *"não consigo rodar nada, não abre as informações dentro
// da chave... nada"*. A causa era que clicar em QUALQUER nó abria uma query
// `SELECT * FROM …` — SQL, num banco que não fala SQL.
//
// Aqui mora só o que não precisa de servidor: qual comando lê cada tipo, como o
// valor vira tela, e como o tamanho e o prazo viram texto. O driver executa; a
// interface desenha o que receber.

/** Os tipos que o Redis devolve em `TYPE`, mais o do módulo JSON. */
export type TipoDeChave =
  | 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'ReJSON-RL';

export const TIPOS_DE_CHAVE: readonly TipoDeChave[] = [
  'string', 'list', 'set', 'zset', 'hash', 'stream', 'ReJSON-RL',
];

/**
 * Quantos elementos se lê de uma coleção de uma vez.
 *
 * Uma lista com um milhão de itens não cabe na tela nem na memória do
 * navegador; o corte é dito na tela em vez de acontecer calado.
 */
export const LIMITE_DE_ELEMENTOS = 500;

export interface ComandoDeLeitura {
  readonly nome: string;
  readonly argumentos: readonly string[];
  /** A resposta vira grade (pares/linhas) ou texto? */
  readonly forma: 'texto' | 'grade';
}

/**
 * O comando que lê aquele tipo.
 *
 * Todas as coleções são lidas com FAIXA, e não inteiras: `LRANGE 0 -1` numa
 * lista grande derruba a memória do processo antes de chegar à tela. Set é a
 * exceção herdada do próprio Redis — `SMEMBERS` não tem faixa —, e por isso vai
 * de `SSCAN`, que tem.
 */
export function comandoDeLeitura(
  tipo: TipoDeChave,
  chave: string,
  limite: number = LIMITE_DE_ELEMENTOS
): ComandoDeLeitura {
  const ate = String(limite - 1);
  switch (tipo) {
    case 'ReJSON-RL':
      return { nome: 'JSON.GET', argumentos: [chave, '$'], forma: 'texto' };
    case 'string':
      return { nome: 'GET', argumentos: [chave], forma: 'texto' };
    case 'list':
      return { nome: 'LRANGE', argumentos: [chave, '0', ate], forma: 'grade' };
    case 'set':
      return { nome: 'SSCAN', argumentos: [chave, '0', 'COUNT', String(limite)], forma: 'grade' };
    case 'zset':
      return {
        nome: 'ZRANGE',
        argumentos: [chave, '0', ate, 'WITHSCORES'],
        forma: 'grade',
      };
    case 'hash':
      return { nome: 'HGETALL', argumentos: [chave], forma: 'grade' };
    case 'stream':
      return {
        nome: 'XRANGE',
        argumentos: [chave, '-', '+', 'COUNT', String(limite)],
        forma: 'grade',
      };
  }
}

/** O comando que conta os elementos — é o que diz se a leitura foi cortada. */
export function comandoDeContagem(tipo: TipoDeChave, chave: string): ComandoDeLeitura | null {
  const de: Partial<Record<TipoDeChave, string>> = {
    list: 'LLEN', set: 'SCARD', zset: 'ZCARD', hash: 'HLEN', stream: 'XLEN',
  };
  const nome = de[tipo];
  return nome === undefined ? null : { nome, argumentos: [chave], forma: 'texto' };
}

export interface ValorDeChave {
  readonly chave: string;
  readonly tipo: TipoDeChave;
  /** Segundos até expirar. `-1` é "sem prazo"; `-2`, "não existe mais". */
  readonly ttl: number;
  /** Bytes em memória, quando o servidor sabe dizer. */
  readonly bytes?: number;
  readonly forma: 'texto' | 'grade';
  readonly texto?: string;
  readonly colunas?: readonly string[];
  readonly linhas?: readonly (readonly string[])[];
  /** Quantos elementos existem ao todo — pode ser mais do que veio. */
  readonly total?: number;
  readonly cortado: boolean;
}

/** As colunas de cada tipo em grade. */
export function colunasDe(tipo: TipoDeChave): readonly string[] {
  switch (tipo) {
    case 'zset': return ['Membro', 'Nota'];
    case 'hash': return ['Campo', 'Valor'];
    case 'stream': return ['Id', 'Campos'];
    case 'list': return ['#', 'Valor'];
    default: return ['Valor'];
  }
}

/**
 * Transforma a resposta crua do Redis nas linhas da grade.
 *
 * Cada tipo devolve uma forma diferente, e é aqui que a diferença acaba:
 * `ZRANGE … WITHSCORES` e `HGETALL` vêm como lista achatada de PARES; `LRANGE`
 * e `SSCAN`, como lista simples; `XRANGE`, como pares de id e campos.
 */
export function linhasDoValor(tipo: TipoDeChave, resposta: unknown): readonly (readonly string[])[] {
  const texto = (v: unknown): string =>
    v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);

  if (tipo === 'stream') {
    if (!Array.isArray(resposta)) return [];
    return resposta.map((entrada) => {
      const par = entrada as unknown[];
      const campos = Array.isArray(par[1]) ? (par[1] as unknown[]).map(texto) : [];
      const juntos: string[] = [];
      for (let i = 0; i < campos.length; i += 2) juntos.push(`${campos[i]}=${campos[i + 1] ?? ''}`);
      return [texto(par[0]), juntos.join(' ')];
    });
  }

  // `SSCAN` devolve [cursor, membros]; os membros é que interessam.
  const lista = tipo === 'set' && Array.isArray(resposta) && Array.isArray(resposta[1])
    ? (resposta[1] as unknown[])
    : Array.isArray(resposta) ? resposta : [];

  if (tipo === 'zset' || tipo === 'hash') {
    // **Duas formas, e as duas são reais.** O `ZRANGE … WITHSCORES` responde
    // uma lista ACHATADA de pares em RESP2 e uma lista de PARES ANINHADOS em
    // RESP3 — visto contra servidor de verdade, não deduzido. Aceitar só uma
    // fazia a grade mostrar `["maria","7"]` dentro de uma célula.
    if (lista.length > 0 && Array.isArray(lista[0])) {
      return lista.map((par) => {
        const dupla = par as unknown[];
        return [texto(dupla[0]), texto(dupla[1])];
      });
    }
    const linhas: string[][] = [];
    for (let i = 0; i < lista.length; i += 2) {
      linhas.push([texto(lista[i]), texto(lista[i + 1])]);
    }
    return linhas;
  }

  if (tipo === 'list') return lista.map((v, i) => [String(i), texto(v)]);
  return lista.map((v) => [texto(v)]);
}

/** "sem prazo", "expirada" ou o tempo que falta, em palavras. */
export function prazoLegivel(ttl: number): string {
  if (ttl === -1) return 'sem prazo';
  if (ttl === -2) return 'expirada';
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}min`;
  if (ttl < 86_400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86_400)}d`;
}

/** Bytes como "10.2K", igual ao que a árvore já mostra ao lado do banco. */
export function tamanhoLegivel(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  const unidades = ['B', 'K', 'M', 'G'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return i === 0 ? `${valor}B` : `${valor.toFixed(1)}${unidades[i]}`;
}

/**
 * Deixa o JSON legível quando ele É um JSON.
 *
 * O que não for JSON volta intocado: um valor de texto puro não pode ser
 * reformatado, e tentar seria corrompê-lo na tela.
 */
export function talvezJson(texto: string): string {
  const limpo = texto.trim();
  if (limpo === '' || !'[{"'.includes(limpo[0] ?? '')) return texto;
  try {
    return JSON.stringify(JSON.parse(limpo), null, 2);
  } catch {
    return texto;
  }
}

/** O que se manda gravar numa chave. */
export interface EscritaDeChave {
  readonly chave: string;
  readonly tipo: TipoDeChave;
  /** O valor novo. Ausente = só o prazo muda. */
  readonly valor?: string;
  /** Segundos, ou `-1` para tirar o prazo. Ausente = o prazo não muda. */
  readonly ttl?: number;
}

/** O que o painel de estado mostra. */
export interface InfoDoServidor {
  readonly versao: string;
  readonly modo: string;
  readonly papel: string;
  readonly so: string;
  /** Segundos de pé. */
  readonly uptime: number;
  readonly memoria: string;
  readonly clientes: number;
  readonly bancos: readonly {
    readonly nome: string; readonly chaves: number;
    readonly expiram: number; readonly ttlMedio: number;
  }[];
  /** O `INFO` cru, para a aba que mostra tudo. */
  readonly bruto: string;
}

/**
 * Lê o `INFO` do Redis, que é `chave:valor` por linha com seções em `# Nome`.
 *
 * O que não vier fica em branco em vez de virar zero: um servidor gerenciado
 * esconde seções inteiras, e "0 clientes conectados" seria uma afirmação falsa.
 */
export function lerInfo(bruto: string): Omit<InfoDoServidor, 'bancos' | 'bruto'> {
  const campos = new Map<string, string>();
  for (const linha of bruto.split(/\r?\n/)) {
    const corte = linha.indexOf(':');
    if (linha.startsWith('#') || corte === -1) continue;
    campos.set(linha.slice(0, corte).trim(), linha.slice(corte + 1).trim());
  }
  const numero = (nome: string): number => {
    const n = Number(campos.get(nome));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    versao: campos.get('redis_version') ?? '',
    modo: campos.get('redis_mode') ?? '',
    papel: campos.get('role') ?? '',
    so: campos.get('os') ?? '',
    uptime: numero('uptime_in_seconds'),
    memoria: campos.get('used_memory_human') ?? '',
    clientes: numero('connected_clients'),
  };
}

/** Uptime em dias, como a ferramenta de referência mostra. */
export function tempoDePe(segundos: number): string {
  const dias = Math.floor(segundos / 86_400);
  if (dias >= 1) return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const horas = Math.floor(segundos / 3600);
  if (horas >= 1) return `${horas}h`;
  return `${Math.floor(segundos / 60)}min`;
}

/**
 * As estatísticas por banco, da seção `# Keyspace` do `INFO`.
 *
 *     db0:keys=4928,expires=277,avg_ttl=42129307
 */
export function estatisticasDeBancos(bruto: string): InfoDoServidor['bancos'] {
  const linhas: InfoDoServidor['bancos'][number][] = [];
  for (const linha of bruto.split(/\r?\n/)) {
    const m = /^(db\d+):keys=(\d+),expires=(\d+),avg_ttl=(\d+)/.exec(linha.trim());
    if (m === null) continue;
    linhas.push({
      nome: m[1] ?? '', chaves: Number(m[2]), expiram: Number(m[3]), ttlMedio: Number(m[4]),
    });
  }
  return linhas;
}

/**
 * Os comandos que gravam uma chave nova de cada tipo.
 *
 * O valor chega como TEXTO da tela; cada tipo o entende de um jeito, e é aqui
 * que a diferença acaba. Uma linha por elemento nas coleções, `campo=valor` nas
 * que têm par — é o que a caixa "Add Row" da ferramenta de referência produz.
 */
export function comandoDeCriacao(
  tipo: TipoDeChave,
  chave: string,
  valor: string
): { nome: string; argumentos: readonly string[] } {
  const linhas = valor.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const pares = (): string[] => {
    const saida: string[] = [];
    for (const linha of linhas) {
      const corte = linha.indexOf('=');
      if (corte === -1) continue;
      saida.push(linha.slice(0, corte), linha.slice(corte + 1));
    }
    return saida;
  };

  switch (tipo) {
    case 'ReJSON-RL': return { nome: 'JSON.SET', argumentos: [chave, '$', valor] };
    case 'string': return { nome: 'SET', argumentos: [chave, valor] };
    case 'list': return { nome: 'RPUSH', argumentos: [chave, ...linhas] };
    case 'set': return { nome: 'SADD', argumentos: [chave, ...linhas] };
    case 'zset': {
      // `ZADD` recebe NOTA antes do membro; a tela escreve `membro=nota`.
      const args: string[] = [];
      for (const linha of linhas) {
        const corte = linha.lastIndexOf('=');
        if (corte === -1) continue;
        args.push(linha.slice(corte + 1), linha.slice(0, corte));
      }
      return { nome: 'ZADD', argumentos: [chave, ...args] };
    }
    case 'hash': return { nome: 'HSET', argumentos: [chave, ...pares()] };
    case 'stream': return { nome: 'XADD', argumentos: [chave, '*', ...pares()] };
  }
}
