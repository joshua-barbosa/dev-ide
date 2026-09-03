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
export function ramosDe(
  chaves: readonly string[],
  prefixo = ''
): readonly RamoDeChaves[] {
  const corte = prefixo === '' ? 0 : prefixo.length;
  const porNome = new Map<string, { quantas: number; ehChave: boolean }>();

  for (const chave of chaves) {
    if (prefixo !== '' && !chave.startsWith(prefixo)) continue;
    const resto = chave.slice(corte);
    if (resto === '') {
      // A própria chave `prefixo` existe. Ela não é um ramo daqui.
      continue;
    }
    const fim = resto.indexOf(SEPARADOR);
    const nome = fim === -1 ? resto : resto.slice(0, fim);
    const atual = porNome.get(nome) ?? { quantas: 0, ehChave: false };
    porNome.set(nome, {
      quantas: atual.quantas + 1,
      // É chave de verdade quando NÃO há nada depois do nome.
      ehChave: atual.ehChave || fim === -1,
    });
  }

  return [...porNome.entries()]
    .map(([nome, d]) => ({
      nome,
      prefixo: `${prefixo}${nome}${SEPARADOR}`,
      quantas: d.quantas,
      ehChave: d.ehChave,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
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
