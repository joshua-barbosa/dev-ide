// MongoDB numa grade de colunas fixas.
//
// **É o driver que mais força o formato**, e por isso a parte difícil mora aqui,
// testada sem banco. Um documento não tem colunas: dois documentos da mesma
// coleção podem ter campos diferentes, e um deles pode ter um objeto onde o
// outro tem um número.
//
// A saída é a mesma que todo cliente de Mongo usa há anos: **achatar** os
// caminhos (`endereco.cidade`) e mostrar o documento cru numa coluna própria.
// Quem quer ler o documento inteiro abre a lupa; quem quer comparar dez
// documentos lê as colunas.

/** Quantos documentos são olhados para decidir as colunas. */
export const AMOSTRA_PARA_COLUNAS = 100;

/** Profundidade máxima do achatamento. */
export const PROFUNDIDADE_MAXIMA = 3;

/**
 * O nome da coluna que traz o documento inteiro.
 *
 * Começa com `_` para não colidir com um campo de verdade — e se um dia
 * colidir, o campo do usuário vence, porque o dado dele importa mais que a
 * nossa conveniência.
 */
export const COLUNA_CRUA = '_documento';

/**
 * Achata um documento em pares `caminho → valor`.
 *
 * **Array NÃO é achatado item a item.** Uma lista de dez itens viraria dez
 * colunas (`tags.0`, `tags.1`…), e o documento seguinte, com três, deixaria sete
 * vazias — a grade viraria um campo minado de colunas quase sempre vazias. A
 * lista inteira vira JSON numa coluna só.
 */
export function achatar(
  documento: Record<string, unknown>,
  prefixo = '',
  profundidade = 0
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(documento)) {
    const caminho = prefixo === '' ? chave : `${prefixo}.${chave}`;

    const ehObjetoSimples =
      valor !== null &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      !(valor instanceof Date) &&
      // `ObjectId`, `Decimal128` e afins têm `toString` próprio e NÃO devem ser
      // abertos: `_id.buffer.0` não diz nada a ninguém.
      (valor.constructor === Object || valor.constructor === undefined);

    if (ehObjetoSimples && profundidade < PROFUNDIDADE_MAXIMA) {
      Object.assign(
        saida,
        achatar(valor as Record<string, unknown>, caminho, profundidade + 1)
      );
      continue;
    }
    saida[caminho] = valor;
  }
  return saida;
}

/**
 * As colunas da grade, a partir de uma amostra.
 *
 * A ordem é **a de aparição**, e não alfabética: o primeiro documento costuma
 * ser o mais representativo, e alfabetar jogaria o `_id` para o meio.
 *
 * Campo que só existe em um documento entre cem ainda vira coluna — esconder
 * seria decidir por quem lê, e uma coluna quase vazia é informação: diz que o
 * campo é raro.
 */
export function colunasDaAmostra(
  documentos: readonly Record<string, unknown>[]
): readonly string[] {
  const vistas: string[] = [];
  const jaTem = new Set<string>();

  for (const doc of documentos.slice(0, AMOSTRA_PARA_COLUNAS)) {
    for (const chave of Object.keys(achatar(doc))) {
      if (jaTem.has(chave)) continue;
      jaTem.add(chave);
      vistas.push(chave);
    }
  }
  return [...vistas, COLUNA_CRUA];
}

/** O valor de uma célula, como texto. */
export function celula(valor: unknown): string | null {
  if (valor === undefined) return null;
  if (valor === null) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

/** As linhas da grade, na ordem das colunas. */
export function linhasDosDocumentos(
  documentos: readonly Record<string, unknown>[],
  colunas: readonly string[]
): readonly (readonly (string | null)[])[] {
  return documentos.map((doc) => {
    const plano = achatar(doc);
    return colunas.map((c) => (c === COLUNA_CRUA ? JSON.stringify(doc) : celula(plano[c])));
  });
}

/**
 * Lê o filtro que a pessoa digitou.
 *
 * Aceita JSON (`{"status":"ativo"}`) e vazio. **Recusa com texto claro** em vez
 * de mandar `{}` quando o JSON está quebrado: mandar tudo por causa de uma
 * vírgula a mais seria devolver a coleção inteira sem ninguém pedir.
 */
export function lerFiltro(texto: string): { filtro: Record<string, unknown> } | { erro: string } {
  const limpo = texto.trim();
  if (limpo === '') return { filtro: {} };
  let lido: unknown;
  try {
    lido = JSON.parse(limpo);
  } catch {
    return {
      erro:
        'O filtro precisa ser um JSON — por exemplo `{"status":"ativo"}`. ' +
        'Vazio traz todos os documentos.',
    };
  }
  if (typeof lido !== 'object' || lido === null || Array.isArray(lido)) {
    return { erro: 'O filtro precisa ser um OBJETO JSON, e não uma lista ou um valor solto.' };
  }
  return { filtro: lido as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// As formas de conectar
// ---------------------------------------------------------------------------

export interface DestinoMongo {
  readonly uri: string;
  readonly banco: string;
  /**
   * Falar SÓ com o servidor do endereço, sem descobrir o conjunto de réplicas.
   *
   * É o irmão do "standalone" do Redis, e existe pelo mesmo motivo: ao conectar
   * num nó de um replica set, o driver pergunta quem são os outros e passa a
   * falar com eles pelos nomes ANUNCIADOS — que num túnel SSH ou atrás de um
   * balanceador são nomes internos, inalcançáveis daqui. A conexão morre com um
   * tempo esgotado que não menciona réplica nenhuma.
   */
  readonly direto: boolean;
}

/**
 * Monta a URI a partir dos campos, ou usa a que ele colou.
 *
 * **`mongodb+srv://` NÃO aceita porta.** O `+srv` faz o driver perguntar ao DNS
 * quais são os servidores e em que portas — é o formato que o Atlas entrega. Pôr
 * porta ali é erro de sintaxe, e a mensagem do driver fala de DNS, não de porta.
 */
export function uriDoMongo(campos: {
  readonly modo?: unknown;
  readonly uri?: unknown;
  readonly host?: unknown;
  readonly port?: unknown;
  readonly username?: unknown;
  readonly password?: unknown;
  readonly database?: unknown;
  readonly auth_source?: unknown;
  readonly replica_set?: unknown;
  readonly tls?: unknown;
  readonly direct?: unknown;
}): { destino: DestinoMongo } | { erro: string } {
  const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const marcado = (v: unknown): boolean => v === true || v === 'true';
  const banco = texto(campos.database);
  const direto = marcado(campos.direct);

  if (campos.modo === 'uri' || (campos.modo === undefined && texto(campos.uri) !== '')) {
    const uri = texto(campos.uri);
    if (uri === '') return { erro: 'A URI está vazia.' };
    if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
      return { erro: 'A URI precisa começar com `mongodb://` ou `mongodb+srv://`.' };
    }
    if (uri.startsWith('mongodb+srv://') && /:\d+/.test(uri.slice('mongodb+srv://'.length))) {
      return {
        erro:
          '`mongodb+srv://` não aceita porta: o DNS é que diz quais servidores e ' +
          'portas usar. Tire o `:porta` da URI.',
      };
    }
    return { destino: { uri, banco, direto } };
  }

  const host = texto(campos.host);
  if (host === '') return { erro: 'Informe o host, ou troque para o modo URI.' };
  const porta = campos.port === undefined || campos.port === '' ? 27017 : Number(campos.port);
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
    return { erro: `Porta inválida: ${String(campos.port)}.` };
  }

  const credencial =
    texto(campos.username) === ''
      ? ''
      : `${encodeURIComponent(texto(campos.username))}:` +
        `${encodeURIComponent(typeof campos.password === 'string' ? campos.password : '')}@`;

  const opcoes: string[] = [];
  // `authSource` é o banco onde o USUÁRIO existe, e quase nunca é o banco que se
  // quer ler. Sem ele, o Mongo procura o usuário no banco de destino e falha com
  // "authentication failed" — que faz qualquer um pensar que a senha está errada.
  if (texto(campos.auth_source) !== '') opcoes.push(`authSource=${texto(campos.auth_source)}`);
  if (texto(campos.replica_set) !== '') opcoes.push(`replicaSet=${texto(campos.replica_set)}`);
  if (marcado(campos.tls)) opcoes.push('tls=true');
  if (direto) opcoes.push('directConnection=true');

  const query = opcoes.length === 0 ? '' : `?${opcoes.join('&')}`;
  return {
    destino: { uri: `mongodb://${credencial}${host}:${porta}/${query}`, banco, direto },
  };
}
