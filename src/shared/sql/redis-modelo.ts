// Redis numa árvore e numa grade: o que é chave, e o que é linha.
//
// **O desafio deste driver não é falar com o Redis — é caber no formato.** A
// IDE tem UMA árvore e UMA grade, e é isso que a mantém coerente: quem aprendeu
// a navegar um banco SQL navega qualquer serviço. Um painel próprio para cada
// tipo seria mais fácil de escrever e pior de usar.
//
// Redis não tem tabelas nem colunas. Tem chaves com nome, e o costume — não a
// regra — é separá-las por `:` (`sessao:1234`, `cache:usuario:9`). Esse costume
// é o que vira árvore aqui.

/** Um degrau da árvore de chaves. */
export interface RamoDeChaves {
  readonly nome: string;
  /** O prefixo completo até aqui, com o separador. */
  readonly prefixo: string;
  /** Quantas chaves existem abaixo, incluindo as dos ramos filhos. */
  readonly quantas: number;
  /** É uma CHAVE de verdade, e não só um agrupamento. */
  readonly ehChave: boolean;
}

export const SEPARADOR = ':';

/**
 * Agrupa chaves pelo primeiro segmento que ainda não foi consumido.
 *
 * **Um nível por vez**, e não a árvore inteira: um Redis de produção tem
 * milhões de chaves, e montar tudo de uma vez travaria a IDE antes de mostrar
 * qualquer coisa. É a mesma navegação preguiçosa da árvore de arquivos.
 *
 * Uma chave que é EXATAMENTE o prefixo aparece junto dos ramos — `sessao` pode
 * ser uma chave e, ao mesmo tempo, o começo de `sessao:1234`. Esconder uma das
 * duas mentiria sobre o que está no banco.
 */
export type AcumuladoDeRamos = Map<string, { quantas: number; ehChave: boolean }>;

/**
 * Soma um LOTE de chaves ao que já foi contado.
 *
 * **Nada de guardar as chaves.** Ele disse que tem muitas chaves no Redis, e a
 * primeira versão disto acumulava tudo numa lista antes de agrupar — o que
 * obrigava a um teto, e o teto truncava a árvore dele.
 *
 * Aqui só o RESULTADO é guardado: um contador por segmento. A memória fica do
 * tamanho do número de nomes distintos naquele nível — dezenas, não milhões —,
 * independentemente de quantas chaves o servidor tenha.
 */
export function acumularRamos(
  acumulado: AcumuladoDeRamos,
  chaves: readonly string[],
  prefixo = ''
): AcumuladoDeRamos {
  const corte = prefixo === '' ? 0 : prefixo.length;

  for (const chave of chaves) {
    if (prefixo !== '' && !chave.startsWith(prefixo)) continue;
    const resto = chave.slice(corte);
    // A própria chave `prefixo` existe. Ela não é um ramo daqui.
    if (resto === '') continue;

    const fim = resto.indexOf(SEPARADOR);
    const nome = fim === -1 ? resto : resto.slice(0, fim);
    const atual = acumulado.get(nome) ?? { quantas: 0, ehChave: false };
    acumulado.set(nome, {
      quantas: atual.quantas + 1,
      // É chave de verdade quando NÃO há nada depois do nome.
      ehChave: atual.ehChave || fim === -1,
    });
  }
  return acumulado;
}

/** Os ramos, na ordem em que a árvore os mostra. */
export function ramosDoAcumulado(
  acumulado: AcumuladoDeRamos,
  prefixo = ''
): readonly RamoDeChaves[] {
  return [...acumulado.entries()]
    .map(([nome, d]) => ({
      nome,
      prefixo: `${prefixo}${nome}${SEPARADOR}`,
      quantas: d.quantas,
      ehChave: d.ehChave,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Atalho de uma passada só — o que os testes usam. */
export function ramosDe(
  chaves: readonly string[],
  prefixo = ''
): readonly RamoDeChaves[] {
  return ramosDoAcumulado(acumularRamos(new Map(), chaves, prefixo), prefixo);
}

/**
 * Comandos que o modo SOMENTE-LEITURA permite.
 *
 * **Aqui a trava é uma lista branca, e não uma transação.** Nos bancos SQL quem
 * impõe o somente-leitura é o servidor (`SET TRANSACTION READ ONLY`), e é por
 * isso que ela é confiável. O Redis não tem esse conceito: `ACL` existe, mas
 * depende de o servidor estar configurado, e a IDE não pode contar com isso.
 *
 * Então a lista é **explícita e curta**: o que não está aqui é recusado. Uma
 * lista negra ("proibir DEL, FLUSHALL…") erraria por omissão a cada versão nova
 * do Redis — e errar por omissão numa trava é o mesmo que não ter trava.
 */
export const COMANDOS_DE_LEITURA: ReadonlySet<string> = new Set([
  'get', 'mget', 'strlen', 'exists', 'ttl', 'pttl', 'type', 'randomkey',
  'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists',
  'lrange', 'llen', 'lindex',
  'smembers', 'scard', 'sismember', 'srandmember', 'sdiff', 'sinter', 'sunion',
  'zrange', 'zrevrange', 'zrangebyscore', 'zcard', 'zscore', 'zrank', 'zcount',
  'scan', 'hscan', 'sscan', 'zscan', 'keys', 'dbsize',
  'info', 'ping', 'time', 'memory', 'object', 'command', 'client', 'config',
  'json.get', 'json.type', 'json.objkeys', 'json.arrlen',
  'xrange', 'xrevrange', 'xlen', 'xinfo',
  'getrange', 'bitcount', 'geopos', 'geodist', 'geohash', 'geosearch',
]);

export interface ComandoLido {
  readonly nome: string;
  readonly argumentos: readonly string[];
}

/**
 * Separa o comando digitado, respeitando aspas.
 *
 * `SET saudacao "bom dia"` são dois argumentos, e não três. Sem isto, um valor
 * com espaço viraria dois — e o erro só apareceria no dado gravado errado.
 */
export function lerComando(linha: string): ComandoLido | null {
  const partes: string[] = [];
  let atual = '';
  let aspas: '"' | "'" | null = null;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i] as string;
    if (aspas !== null) {
      if (c === '\\' && linha[i + 1] === aspas) {
        atual += aspas;
        i += 1;
      } else if (c === aspas) {
        aspas = null;
      } else {
        atual += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      aspas = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (atual !== '') partes.push(atual);
      atual = '';
      continue;
    }
    atual += c;
  }
  if (atual !== '') partes.push(atual);

  const [nome, ...argumentos] = partes;
  return nome === undefined ? null : { nome, argumentos };
}

/** Se o comando pode rodar com a conexão em somente-leitura. */
export function podeRodarSomenteLeitura(nome: string): boolean {
  return COMANDOS_DE_LEITURA.has(nome.toLowerCase());
}

/**
 * A resposta do Redis numa grade de duas colunas.
 *
 * O Redis devolve escalar, lista, mapa ou aninhado. A grade tem colunas fixas,
 * então cada forma vira linhas de `campo` e `valor` — que é como um `HGETALL` já
 * se lê naturalmente, e o mais próximo de honesto para as outras.
 */
export function linhasDaResposta(
  resposta: unknown
): { readonly colunas: readonly string[]; readonly linhas: readonly (readonly string[])[] } {
  if (resposta === null || resposta === undefined) {
    return { colunas: ['valor'], linhas: [['(nil)']] };
  }
  if (Array.isArray(resposta)) {
    return {
      colunas: ['#', 'valor'],
      linhas: resposta.map((v, i) => [String(i + 1), textoDe(v)]),
    };
  }
  if (typeof resposta === 'object') {
    return {
      colunas: ['campo', 'valor'],
      linhas: Object.entries(resposta as Record<string, unknown>).map(([k, v]) => [k, textoDe(v)]),
    };
  }
  return { colunas: ['valor'], linhas: [[textoDe(resposta)]] };
}

function textoDe(v: unknown): string {
  if (v === null || v === undefined) return '(nil)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// As DUAS formas de conectar
// ---------------------------------------------------------------------------
//
// Ele apontou: *"Redis tem duas formas de conectar, string url e hosts, port,
// user e pass"*. As duas existem no mundo real — a URL é o que se copia de um
// painel de nuvem, e os campos separados são o que se digita quando se sabe o
// servidor de cabeça.
//
// Oferecer as duas é fácil; o que erra é **interpretar a URL**, e por isso ela
// é interpretada aqui, com teste.

export interface DestinoRedis {
  readonly host: string;
  readonly porta: number;
  /**
   * O usuário, ou `''` para **não mandar usuário nenhum**.
   *
   * Vazio não é "faltou preencher": é o `requirepass` clássico, em que o `AUTH`
   * leva só a senha. Ver a nota 4 de `lerUrlDeRedis`.
   */
  readonly usuario: string;
  readonly senha: string;
  readonly banco: number;
  readonly tls: boolean;
  /**
   * Não procurar cluster: falar com ESTE servidor e mais nenhum.
   *
   * Ele pediu a opção. Sem ela, o cliente pergunta ao servidor se há cluster e
   * passa a seguir os redirecionamentos `MOVED` para os outros nós — o que é
   * certo num cluster de verdade e **errado** quando o endereço é um túnel SSH,
   * um balanceador ou um proxy: os nós anunciados têm IPs internos, que a
   * máquina dele não alcança, e a conexão morre com um tempo esgotado que não
   * menciona cluster nenhum.
   */
  readonly standalone: boolean;
}

export const PORTA_PADRAO = 6379;

/**
 * Interpreta uma URL de Redis.
 *
 * Quatro armadilhas, todas com teste:
 *
 * 1. **`rediss://` com dois esses é TLS.** Um `s` a mais decide se o tráfego vai
 *    cifrado, e confundir os dois falha com "connection reset" — que não diz
 *    nada sobre o que estava errado.
 * 2. **A senha pode conter `@` e `:`.** Vem codificada na URL, e decodificá-la
 *    é obrigatório: quem tem `p@ss` na senha veria a IDE cortar o host no lugar
 *    errado.
 * 3. **O banco vai no CAMINHO** (`/2`), e não numa opção. Vazio é o banco 0.
 * 4. **Sem usuário NÃO se inventa um.** Ele avisou: *"tem alguns acessos que não
 *    têm usuário, só password"* — é o `requirepass` de sempre, e nele o `AUTH`
 *    leva um argumento só. Mandar `default` transforma isso em `AUTH default
 *    senha`, que o Redis 5 e anteriores recusam, e a falha aparece como
 *    "autenticação inválida" sem dizer que a IDE acrescentou um usuário que
 *    ninguém pediu. Usuário vazio significa **não mandar usuário**.
 */
export function lerUrlDeRedis(texto: string): { destino: DestinoRedis } | { erro: string } {
  const limpo = texto.trim();
  if (limpo === '') return { erro: 'A URL está vazia.' };

  let u: URL;
  try {
    u = new URL(limpo);
  } catch {
    return {
      erro: 'Não consegui ler esta URL. O formato é `redis://usuario:senha@host:6379/0`.',
    };
  }

  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') {
    return {
      erro:
        `Protocolo "${u.protocol.replace(':', '')}" não é de Redis. ` +
        'Use `redis://` ou `rediss://` (com dois esses, para TLS).',
    };
  }

  const host = u.hostname === '' ? '127.0.0.1' : u.hostname;
  const porta = u.port === '' ? PORTA_PADRAO : Number(u.port);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
    return { erro: `Porta inválida na URL: ${u.port}.` };
  }

  // O caminho é `/2` para o banco 2. Vazio ou `/` é o banco 0.
  const caminho = u.pathname.replace(/^\//, '');
  const banco = caminho === '' ? 0 : Number(caminho);
  if (!Number.isInteger(banco) || banco < 0) {
    return { erro: `O caminho da URL deve ser o número do banco, e veio "${caminho}".` };
  }

  return {
    destino: {
      host,
      porta,
      // `decodeURIComponent` porque senha com `@` ou `:` chega codificada.
      // Vazio fica vazio: `redis://:senha@host` é a forma padrão de "só senha".
      usuario: u.username === '' ? '' : decodeURIComponent(u.username),
      senha: u.password === '' ? '' : decodeURIComponent(u.password),
      banco,
      tls: u.protocol === 'rediss:',
      // A URL não fala de cluster; quem decide é o campo. Ver `destinoDaConexao`.
      standalone: false,
    },
  };
}

/**
 * O destino, venha ele da URL ou dos campos separados.
 *
 * **A URL vence quando está preenchida**, e não se mistura com os campos: um
 * host da URL com a senha do campo daria uma combinação que não existe em lugar
 * nenhum, e o erro apareceria como "autenticação falhou" sem explicação.
 */
export function destinoDaConexao(campos: {
  readonly modo?: unknown;
  readonly url?: unknown;
  readonly host?: unknown;
  readonly port?: unknown;
  readonly username?: unknown;
  readonly password?: unknown;
  readonly database?: unknown;
  readonly tls?: unknown;
  readonly standalone?: unknown;
}): { destino: DestinoRedis } | { erro: string } {
  const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const marcado = (v: unknown): boolean => v === true || v === 'true';

  if (campos.modo === 'url' || (campos.modo === undefined && texto(campos.url) !== '')) {
    const lido = lerUrlDeRedis(texto(campos.url));
    if ('erro' in lido) return lido;
    return {
      destino: {
        ...lido.destino,
        // **A marca de TLS SOMA com o esquema, e nunca subtrai.** `rediss://`
        // já é TLS, e uma caixa desmarcada não deve rebaixar isso em silêncio —
        // seria a IDE decidindo mandar a senha em claro. Marcar liga o TLS
        // mesmo com `redis://`, que é o caso de quem recebeu a URL sem os dois
        // esses mas cujo servidor exige a cifra.
        tls: lido.destino.tls || marcado(campos.tls),
        standalone: marcado(campos.standalone),
      },
    };
  }

  const host = texto(campos.host);
  if (host === '') return { erro: 'Informe o host, ou troque para o modo URL.' };

  const porta = campos.port === undefined || campos.port === '' ? PORTA_PADRAO : Number(campos.port);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
    return { erro: `Porta inválida: ${String(campos.port)}.` };
  }
  const banco =
    campos.database === undefined || campos.database === '' ? 0 : Number(campos.database);
  if (!Number.isInteger(banco) || banco < 0) {
    return { erro: `Banco inválido: ${String(campos.database)}.` };
  }

  return {
    destino: {
      host,
      porta,
      // Vazio fica vazio — ver a nota 4 de `lerUrlDeRedis`.
      usuario: texto(campos.username),
      senha: typeof campos.password === 'string' ? campos.password : '',
      banco,
      tls: marcado(campos.tls),
      standalone: marcado(campos.standalone),
    },
  };
}

/**
 * Falar com um servidor só, ou seguir o cluster.
 *
 * `forcado` é a marca dele. `clusterHabilitado` é o que o servidor respondeu no
 * `INFO cluster`.
 *
 * **A marca vence a detecção**, e é esse o ponto de existir: quem liga o
 * standalone está dizendo "eu sei que este endereço é um túnel, um balanceador
 * ou um proxy — não vá atrás dos outros nós". Deixar a detecção ganhar
 * transformaria a opção em enfeite.
 */
export function modoDeConexao(
  forcado: boolean,
  clusterHabilitado: boolean
): 'standalone' | 'cluster' {
  if (forcado) return 'standalone';
  return clusterHabilitado ? 'cluster' : 'standalone';
}

// ---------------------------------------------------------------------------
// RediSearch e RedisJSON
// ---------------------------------------------------------------------------
//
// Ele: *"em sua maioria eu uso indexações, então tenho RedisJSON e
// RedisSearch"*. Isso muda o peso das coisas: navegar por prefixo vira o caso
// SECUNDÁRIO, e o principal é buscar num índice.
//
// **A resposta do `FT.SEARCH` é a parte que erra**, porque não é uma lista de
// documentos: é uma lista PLANA em que o total vem primeiro e depois se
// alternam chave e conteúdo. Ler isso errado desloca tudo por um, e o resultado
// fica plausível — cada documento mostrando o conteúdo do vizinho.

/** Comandos de leitura dos módulos, somados à lista branca. */
export const COMANDOS_DE_MODULO: ReadonlySet<string> = new Set([
  'ft.search', 'ft.aggregate', 'ft.info', 'ft._list', 'ft.explain', 'ft.explaincli',
  'ft.tagvals', 'ft.spellcheck', 'ft.syndump', 'ft.cursor',
  'json.get', 'json.mget', 'json.type', 'json.objkeys', 'json.objlen',
  'json.arrlen', 'json.arrindex', 'json.strlen', 'json.resp', 'json.debug',
]);

export interface AcertoDaBusca {
  readonly chave: string;
  readonly campos: Record<string, unknown>;
}

export interface RespostaDeBusca {
  readonly total: number;
  readonly acertos: readonly AcertoDaBusca[];
}

/**
 * Lê a resposta do `FT.SEARCH`.
 *
 * O formato é `[total, chave1, [campo, valor, …], chave2, [campo, valor, …]]`.
 * Com `NOCONTENT` as listas somem e sobram só as chaves: `[total, chave1,
 * chave2]`. As duas formas chegam pelo mesmo caminho, e distinguir é olhar se o
 * item seguinte é uma lista.
 *
 * **Um documento do RedisJSON vem como um campo só, chamado `$`**, com o JSON
 * inteiro dentro — e é isso que faz um resultado de busca parecer ter uma coluna
 * só quando ele tem vinte.
 */
export function lerRespostaDeBusca(resposta: unknown): RespostaDeBusca {
  if (!Array.isArray(resposta) || resposta.length === 0) {
    return { total: 0, acertos: [] };
  }

  const total = Number(resposta[0]);
  const acertos: AcertoDaBusca[] = [];

  for (let i = 1; i < resposta.length; i += 1) {
    const chave = String(resposta[i]);
    const seguinte = resposta[i + 1];

    if (!Array.isArray(seguinte)) {
      // `NOCONTENT`: só a chave.
      acertos.push({ chave, campos: {} });
      continue;
    }

    const campos: Record<string, unknown> = {};
    for (let j = 0; j + 1 < seguinte.length; j += 2) {
      campos[String(seguinte[j])] = seguinte[j + 1];
    }
    acertos.push({ chave, campos });
    i += 1;
  }

  return { total: Number.isFinite(total) ? total : acertos.length, acertos };
}

/**
 * Se o campo é um documento JSON inteiro, devolve-o já aberto.
 *
 * O RediSearch entrega o RedisJSON num campo `$` (ou `$.algo`, quando o índice
 * declara um caminho). Deixar isso como uma coluna de texto com o JSON dentro
 * seria mostrar o documento e não deixar comparar nada entre linhas.
 */
export function abrirCampoJson(campos: Record<string, unknown>): Record<string, unknown> {
  const caminhos = Object.keys(campos).filter((k) => k === '$' || k.startsWith('$.'));
  if (caminhos.length === 0) return campos;

  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    if (!caminhos.includes(chave)) {
      saida[chave] = valor;
      continue;
    }
    if (typeof valor !== 'string') {
      saida[chave] = valor;
      continue;
    }
    try {
      const lido = JSON.parse(valor) as unknown;
      // `$` num índice JSON devolve o documento; alguns servidores o embrulham
      // numa lista de um item, e mostrar `[{…}]` seria mostrar o embrulho.
      const doc = Array.isArray(lido) && lido.length === 1 ? lido[0] : lido;
      if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
        Object.assign(saida, doc as Record<string, unknown>);
      } else {
        saida[chave] = doc;
      }
    } catch {
      // Não era JSON: fica como veio, em vez de sumir.
      saida[chave] = valor;
    }
  }
  return saida;
}

/** Se o comando é de leitura, contando os módulos. */
export function podeRodarSomenteLeituraComModulos(nome: string): boolean {
  const n = nome.toLowerCase();
  return COMANDOS_DE_LEITURA.has(n) || COMANDOS_DE_MODULO.has(n);
}
