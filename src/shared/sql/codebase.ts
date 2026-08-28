// O "codebase" do banco conectado (T053, spec 071).
//
// Nome dele, na triagem: *"uma espécie de 'codebase' do banco conectado"* — a
// lista de tabelas, colunas, views, procedures, functions e das FUNÇÕES do
// próprio banco, lida uma vez e guardada, para o editor sugerir sem ir ao
// servidor a cada tecla.
//
// Este arquivo tem só o FORMATO e a decisão do que sugerir. Ler do catálogo é
// dos drivers; desenhar é do Monaco. A decisão é o que erra na prática — e é o
// que dá para testar sem banco e sem tela.

export interface ColunaDoCodebase {
  readonly nome: string;
  readonly tipo: string;
}

export type EspecieDeObjeto = 'tabela' | 'view' | 'procedure' | 'function';

export interface ObjetoDoCodebase {
  readonly nome: string;
  readonly especie: EspecieDeObjeto;
  /** Schema do objeto. Vazio no MySQL e no SQLite, que não têm o nível. */
  readonly schema: string;
  /** Só tabela e view têm; rotina não. */
  readonly colunas: readonly ColunaDoCodebase[];
}

export interface Codebase {
  readonly database: string;
  readonly objetos: readonly ObjetoDoCodebase[];
  /** As funções do BANCO (`now`, `coalesce`, `json_extract`…). */
  readonly funcoes: readonly string[];
  /** Quando foi lido, em epoch — a tela mostra, e o F5 não relê à toa. */
  readonly lidoEm: number;
  /**
   * O catálogo foi CORTADO por tamanho.
   *
   * Um banco com 40 mil colunas não cabe na memória da aba, e sugerir de um
   * catálogo pela metade sem dizer seria o erro do total estimado outra vez.
   */
  readonly cortado: boolean;
}

export const CODEBASE_VAZIO: Codebase = {
  database: '',
  objetos: [],
  funcoes: [],
  lidoEm: 0,
  cortado: false,
};

/** Teto de objetos por catálogo. Acima disto a leitura para e avisa. */
export const MAX_OBJETOS_NO_CODEBASE = 5_000;

export type Genero = 'objeto' | 'coluna' | 'funcao' | 'palavra';

export interface Sugestao {
  readonly texto: string;
  readonly genero: Genero;
  /** O que aparece do lado direito: o tipo da coluna, a espécie do objeto. */
  readonly detalhe: string;
  /** De onde ela veio, quando a origem ajuda: a tabela de uma coluna. */
  readonly origem: string;
}

/**
 * As palavras da linguagem. Vêm por último e só quando nada mais casa melhor —
 * o Monaco já sugere as dele, e repeti-las duplicaria a lista.
 */
const PALAVRAS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'GROUP BY',
  'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE',
  'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'AS',
  'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'BETWEEN',
  'LIKE', 'DISTINCT', 'COUNT', 'UNION', 'WITH',
];

/** Onde o cursor está, para decidir o que faz sentido oferecer. */
export interface Contexto {
  /** O prefixo `alvo.` imediatamente antes do cursor, sem o ponto. */
  readonly qualificador: string | null;
  /** A última palavra-chave estrutural antes do cursor. */
  readonly depoisDe: string | null;
}

const ESTRUTURAIS = new Set([
  'FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE', 'SELECT', 'WHERE', 'ON', 'SET',
  'BY', 'HAVING', 'AND', 'OR', 'VALUES',
]);

/**
 * Lê o contexto do texto ANTES do cursor.
 *
 * Trabalha de trás para frente, o que é o que torna isto barato: um arquivo de
 * mil linhas não precisa ser analisado para saber que o cursor está depois de
 * um `FROM`.
 */
export function lerContexto(antesDoCursor: string): Contexto {
  // `pedido.` ou `p.` — o que vem antes do ponto é a tabela ou o apelido dela.
  const qualificado = /([A-Za-z_][A-Za-z0-9_$]*)\.\s*[A-Za-z0-9_$]*$/.exec(antesDoCursor);

  // A última palavra ANTES do trecho que se está digitando.
  const palavras = antesDoCursor
    .replace(/[A-Za-z0-9_$.]*$/, '')
    .toUpperCase()
    .match(/[A-Z_]+/g);
  let depoisDe: string | null = null;
  for (let i = (palavras?.length ?? 0) - 1; i >= 0; i -= 1) {
    const p = palavras?.[i] ?? '';
    if (ESTRUTURAIS.has(p)) {
      depoisDe = p;
      break;
    }
  }
  return { qualificador: qualificado?.[1] ?? null, depoisDe };
}

/**
 * Os apelidos declarados no texto: `FROM pedidos p` e `JOIN itens AS i`.
 *
 * Sem isto, `p.` não sugeriria nada — e escrever `pedidos.` por extenso é
 * justamente o que o apelido existe para evitar.
 */
export function apelidos(texto: string): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>();
  const regex =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+([A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?)\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_$]*)/gi;
  for (const m of texto.matchAll(regex)) {
    const alvo = m[1] ?? '';
    const apelido = m[2] ?? '';
    // `FROM pedidos WHERE` — `WHERE` não é apelido. A lista fechada evita
    // inventar um apelido a cada palavra-chave que siga uma tabela.
    if (ESTRUTURAIS.has(apelido.toUpperCase())) continue;
    if (/^(WHERE|ORDER|GROUP|LIMIT|LEFT|RIGHT|INNER|OUTER|CROSS|ON|USING)$/i.test(apelido)) continue;
    mapa.set(apelido.toLowerCase(), alvo.split('.').pop() ?? alvo);
  }
  return mapa;
}

function colunasDe(codebase: Codebase, nomeDaTabela: string): readonly ColunaDoCodebase[] {
  const alvo = nomeDaTabela.toLowerCase();
  return codebase.objetos.find((o) => o.nome.toLowerCase() === alvo)?.colunas ?? [];
}

const ESPECIE: Readonly<Record<EspecieDeObjeto, string>> = {
  tabela: 'tabela',
  view: 'view',
  procedure: 'procedure',
  function: 'function',
};

/**
 * O que oferecer, na ordem em que deve aparecer.
 *
 * Três regras, e cada uma existe por um motivo concreto:
 *
 * 1. **`alvo.` só oferece as colunas daquele alvo.** Oferecer tabela e função
 *    depois de um ponto é ruído garantido — ali nunca cabe outra coisa.
 * 2. **Depois de `FROM`, `JOIN`, `INTO` e `UPDATE`, vêm as tabelas primeiro.**
 *    Coluna ali é erro de sintaxe, e função quase sempre também.
 * 3. **No resto, coluna antes de tabela.** É o que se digita mais.
 */
export function sugestoes(
  codebase: Codebase,
  antesDoCursor: string,
  /**
   * O documento INTEIRO, para os apelidos.
   *
   * Em `SELECT a.| FROM alunos a` o apelido está DEPOIS do cursor — ler só o
   * prefixo faria `a.` não sugerir nada justamente no caso mais comum.
   */
  textoCompleto: string = antesDoCursor
): readonly Sugestao[] {
  const contexto = lerContexto(antesDoCursor);
  const mapaDeApelidos = apelidos(textoCompleto);

  if (contexto.qualificador !== null) {
    const nome = mapaDeApelidos.get(contexto.qualificador.toLowerCase())
      ?? contexto.qualificador;
    return colunasDe(codebase, nome).map((c) => ({
      texto: c.nome,
      genero: 'coluna' as const,
      detalhe: c.tipo,
      origem: nome,
    }));
  }

  const tabelas: Sugestao[] = codebase.objetos
    .filter((o) => o.especie === 'tabela' || o.especie === 'view')
    .map((o) => ({ texto: o.nome, genero: 'objeto' as const, detalhe: ESPECIE[o.especie], origem: o.schema }));

  const rotinas: Sugestao[] = codebase.objetos
    .filter((o) => o.especie === 'procedure' || o.especie === 'function')
    .map((o) => ({ texto: o.nome, genero: 'objeto' as const, detalhe: ESPECIE[o.especie], origem: o.schema }));

  if (contexto.depoisDe === 'FROM' || contexto.depoisDe === 'JOIN'
      || contexto.depoisDe === 'INTO' || contexto.depoisDe === 'UPDATE'
      || contexto.depoisDe === 'TABLE') {
    return [...tabelas, ...rotinas];
  }

  // As colunas de TODAS as tabelas citadas no texto, sem repetir nome.
  const citadas = new Set([...mapaDeApelidos.values()].map((t) => t.toLowerCase()));
  const vistas = new Set<string>();
  const colunas: Sugestao[] = [];
  for (const objeto of codebase.objetos) {
    if (!citadas.has(objeto.nome.toLowerCase())) continue;
    for (const coluna of objeto.colunas) {
      if (vistas.has(coluna.nome.toLowerCase())) continue;
      vistas.add(coluna.nome.toLowerCase());
      colunas.push({ texto: coluna.nome, genero: 'coluna', detalhe: coluna.tipo, origem: objeto.nome });
    }
  }

  const funcoes: Sugestao[] = codebase.funcoes.map((f) => ({
    texto: f,
    genero: 'funcao' as const,
    detalhe: 'função do banco',
    origem: codebase.database,
  }));

  const palavras: Sugestao[] = PALAVRAS.map((p) => ({
    texto: p,
    genero: 'palavra' as const,
    detalhe: 'SQL',
    origem: '',
  }));

  return [...colunas, ...tabelas, ...rotinas, ...funcoes, ...palavras];
}
