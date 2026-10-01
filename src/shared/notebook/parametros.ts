// `{{nome}}` numa célula SQL do notebook (spec 112, etapa 4).
//
// O valor vem do kernel e vai SEMPRE como parâmetro da consulta — nunca colado
// no texto. Colado, uma variável com aspas (`O'Brien`) quebraria o SQL, e uma
// maliciosa viraria injeção. Aqui não há concatenação de VALOR em lugar
// nenhum: só marcadores (`?`, `$1`, `@p1`) entram no texto.
//
// Só vale fora de texto e de comentário: `'{{x}}'` é o texto "{{x}}", e é assim
// que ele fica.

export type EstiloDeParametro = 'interrogacao' | 'dolar' | 'arroba';
export type ValorDeParametro = string | number | boolean | null;

/**
 * `{{nome}}`, ou `{{nome(col1, col2)}}` — os PARES de uma lista de objetos
 * (spec 114, A): `WHERE (id, code) IN {{pedidos(id, code)}}`.
 */
type Parte =
  | { readonly texto: string }
  | {
      readonly nome: string;
      readonly colunas: readonly string[] | null;
      /** `{{item.id}}`: o caminho DENTRO da variável (spec 114, B). */
      readonly campos: readonly string[];
    };

const REFERENCIA = /^([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*(?:\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\))?$/;

/** Varre o SQL separando texto de `{{nome}}` — pulando aspas e comentários. */
function partes(sql: string): Parte[] {
  const saida: Parte[] = [];
  let texto = '';
  let i = 0;
  const fecha: Record<string, string> = { "'": "'", '"': '"', '`': '`' };
  while (i < sql.length) {
    const c = sql[i];
    if (c in fecha) {
      // Aspa: até a que fecha; aspa dobrada é escape e continua dentro.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j += 1;
      }
      texto += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      const fim = sql.indexOf('\n', i);
      const ate = fim === -1 ? sql.length : fim;
      texto += sql.slice(i, ate);
      i = ate;
    } else if (c === '/' && sql[i + 1] === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const ate = fim === -1 ? sql.length : fim + 2;
      texto += sql.slice(i, ate);
      i = ate;
    } else if (c === '{' && sql[i + 1] === '{') {
      const fim = sql.indexOf('}}', i + 2);
      const dentro = fim === -1 ? '' : sql.slice(i + 2, fim).trim();
      const ref = REFERENCIA.exec(dentro);
      if (ref !== null) {
        if (texto !== '') saida.push({ texto });
        texto = '';
        saida.push({
          nome: ref[1],
          campos: ref[2] === '' ? [] : ref[2].slice(1).split('.'),
          colunas: ref[3] === undefined ? null : ref[3].split(',').map((c) => c.trim()),
        });
        i = fim + 2;
      } else {
        texto += c;
        i += 1;
      }
    } else {
      texto += c;
      i += 1;
    }
  }
  if (texto !== '') saida.push({ texto });
  return saida;
}

/** Os nomes que a célula pede ao kernel, na ordem, sem repetir. */
export function referenciasDoSql(sql: string): string[] {
  const nomes: string[] = [];
  for (const p of partes(sql)) if ('nome' in p && !nomes.includes(p.nome)) nomes.push(p.nome);
  return nomes;
}

/**
 * Os nomes pedidos COM colunas (`{{pedidos(id, code)}}`): o kernel os entrega
 * como lista de objetos — um DataFrame do Python vira registros, em vez de
 * recusar por ter várias colunas.
 */
export function colunasPedidas(sql: string): string[] {
  const nomes: string[] = [];
  for (const p of partes(sql)) {
    if ('nome' in p && p.colunas !== null && !nomes.includes(p.nome)) nomes.push(p.nome);
  }
  return nomes;
}

const ehRegistro = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function comoParametro(v: unknown): ValorDeParametro {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
}

export function montarSqlComParametros(
  sql: string,
  valores: Readonly<Record<string, unknown>>,
  estilo: EstiloDeParametro,
  /** O banco (postgres, mysql, mariadb, sqlserver, sqlite): sem ele, `FROM {{x}}` não vira tabela. */
  dialeto?: string
): { readonly sql: string; readonly params: ValorDeParametro[] } {
  const params: ValorDeParametro[] = [];
  const marcador = (): string => {
    const n = params.length;
    return estilo === 'dolar' ? `$${n}` : estilo === 'arroba' ? `@p${n}` : '?';
  };
  let saida = '';
  const todas = partes(sql);
  for (const [k, p] of todas.entries()) {
    if ('texto' in p) {
      saida += p.texto;
      continue;
    }
    // `FROM {{x}}` / `JOIN {{x}}`: a lista como TABELA (spec 114, D) — a
    // função JSON do banco, com colunas e tipos inferidos, num parâmetro só.
    const comoTabela = /\b(from|join)\s*$/i.test(saida);
    if (comoTabela && dialeto !== undefined && DIALETOS_DE_TABELA.has(dialeto)) {
      if (!(p.nome in valores)) {
        throw new Error(`{{${p.nome}}}: a variável "${p.nome}" não existe no kernel. Rode antes a célula que a cria.`);
      }
      const seguinte = todas[k + 1];
      const temApelido = seguinte !== undefined && 'texto' in seguinte && temApelidoNoComeco(seguinte.texto);
      saida += tabelaDe(p.nome, valores[p.nome], dialeto, (v) => {
        params.push(v);
        return marcador();
      });
      if (!temApelido) saida += ` AS ${p.nome}`;
      continue;
    }
    // Sem saber o banco, o banco só diria "syntax error at $1".
    if (comoTabela) {
      throw new Error(
        `{{${p.nome}}} é um VALOR (vira parâmetro), não uma tabela. Para consultar uma lista como tabela no ` +
          `Postgres: guarde-a em JSON (JS: ${p.nome}Json = JSON.stringify(${p.nome}); Python: ` +
          `${p.nome}_json = json.dumps(${p.nome})) e use json_to_recordset({{${p.nome}Json}}::json) AS t(coluna tipo, …).`
      );
    }
    if (!(p.nome in valores)) {
      throw new Error(`{{${p.nome}}}: a variável "${p.nome}" não existe no kernel. Rode antes a célula que a cria.`);
    }
    // `{{item.id}}`: desce pelos campos; o que não existe vira NULL.
    const valor = p.campos.reduce<unknown>((v, campo) => (ehRegistro(v) ? (v[campo] ?? null) : null), valores[p.nome]);
    if (p.colunas !== null) {
      saida += pares(p.nome, p.colunas, valor, estilo, (v) => {
        params.push(comoParametro(v));
        return marcador();
      });
      continue;
    }
    if (Array.isArray(valor)) {
      // Lista vazia: `IN (NULL)` não casa nada — e `IN ()` seria erro de sintaxe.
      if (valor.length === 0) {
        saida += '(NULL)';
        continue;
      }
      const marcadores = valor.map((v) => {
        params.push(comoParametro(v));
        return marcador();
      });
      saida += `(${marcadores.join(', ')})`;
    } else {
      params.push(comoParametro(valor));
      saida += marcador();
    }
  }
  return { sql: saida, params };
}

/**
 * O `sql()` de dentro do kernel (spec 114, C): o código escreve SEMPRE `?`, em
 * qualquer banco, e aqui ele vira o marcador do banco (`$1`, `@p0`). `?`
 * dentro de texto ou comentário fica como está.
 */
export function trocarInterrogacoes(sql: string, valores: number, estilo: EstiloDeParametro): string {
  let n = 0;
  let saida = '';
  for (const p of partes(sql)) {
    if (!('texto' in p)) {
      const caminho = [p.nome, ...p.campos].join('.');
      saida += p.colunas === null ? `{{${caminho}}}` : `{{${caminho}(${p.colunas.join(', ')})}}`;
      continue;
    }
    saida += trocarForaDeTexto(p.texto, () => {
      const atual = n;
      n += 1;
      // Os dois começam em 1: `$1` no Postgres, `@p1` no SQL Server (o driver nomeia p1, p2…).
      return estilo === 'dolar' ? `$${atual + 1}` : estilo === 'arroba' ? `@p${atual + 1}` : '?';
    });
  }
  if (n !== valores) {
    throw new Error(`O comando tem ${n} marcador(es) ? e ${valores} valor(es): passe um valor para cada ?.`);
  }
  return saida;
}

/** Troca cada `?` fora de aspas e comentários. */
function trocarForaDeTexto(texto: string, proximo: () => string): string {
  let saida = '';
  let i = 0;
  const fecha: Record<string, string> = { "'": "'", '"': '"', '`': '`' };
  while (i < texto.length) {
    const c = texto[i];
    if (c in fecha) {
      let j = i + 1;
      while (j < texto.length) {
        if (texto[j] === c && texto[j + 1] === c) j += 2;
        else if (texto[j] === c) break;
        else j += 1;
      }
      saida += texto.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && texto[i + 1] === '-') {
      const fim = texto.indexOf('\n', i);
      const ate = fim === -1 ? texto.length : fim;
      saida += texto.slice(i, ate);
      i = ate;
    } else if (c === '/' && texto[i + 1] === '*') {
      const fim = texto.indexOf('*/', i + 2);
      const ate = fim === -1 ? texto.length : fim + 2;
      saida += texto.slice(i, ate);
      i = ate;
    } else if (c === '?') {
      saida += proximo();
      i += 1;
    } else {
      saida += c;
      i += 1;
    }
  }
  return saida;
}

/** `{{nome(a, b)}}` → `((?, ?), (?, ?))`; uma coluna só → `(?, ?)`. */
function pares(
  nome: string,
  colunas: readonly string[],
  valor: unknown,
  estilo: EstiloDeParametro,
  marcar: (v: unknown) => string
): string {
  if (!Array.isArray(valor) || !valor.every(ehRegistro)) {
    throw new Error(
      `{{${nome}(${colunas.join(', ')})}} pede uma lista de objetos (como [{ ${colunas[0]}: … }]); ` +
        `"${nome}" não é.`
    );
  }
  if (colunas.length > 1 && estilo === 'arroba') {
    throw new Error(
      `{{${nome}(${colunas.join(', ')})}}: o SQL Server não aceita pares no IN ((a, b) IN …). Use sql() num ` +
        'laço numa célula de código, ou a receita do JSON (OPENJSON) — veja a Ajuda.'
    );
  }
  if (colunas.length === 1) {
    if (valor.length === 0) return '(NULL)';
    return `(${valor.map((item) => marcar(item[colunas[0]] ?? null)).join(', ')})`;
  }
  if (valor.length === 0) return `((${colunas.map(() => 'NULL').join(', ')}))`;
  return `(${valor.map((item) => `(${colunas.map((c) => marcar(item[c] ?? null)).join(', ')})`).join(', ')})`;
}

// ---------------------------------------------------------------------------
// {{lista}} como TABELA (spec 114, D)
// ---------------------------------------------------------------------------

const DIALETOS_DE_TABELA = new Set(['postgres', 'mysql', 'mariadb', 'sqlserver', 'sqlite']);

/** Os nomes usados como tabela (`FROM {{x}}`, `JOIN {{x}}`): o kernel entrega registros. */
export function tabelasPedidas(sql: string): string[] {
  const nomes: string[] = [];
  let antes = '';
  for (const p of partes(sql)) {
    if ('texto' in p) {
      antes += p.texto;
      continue;
    }
    if (/\b(from|join)\s*$/i.test(antes) && !nomes.includes(p.nome)) nomes.push(p.nome);
    antes += '?';
  }
  return nomes;
}

/** Depois da subconsulta vem um apelido do usuário (`m`, `AS m`)? */
const NAO_SAO_APELIDO = new Set([
  'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'on', 'using', 'group', 'order', 'limit',
  'offset', 'union', 'except', 'intersect', 'having', 'window', 'for', 'fetch', 'returning', 'into', 'set',
]);

function temApelidoNoComeco(texto: string): boolean {
  const palavra = /^\s*([A-Za-z_][A-Za-z0-9_]*|"[^"]+"|`[^`]+`|\[[^\]]+\])/.exec(texto);
  if (palavra === null) return false;
  return !NAO_SAO_APELIDO.has(palavra[1].toLowerCase());
}

type TipoInferido = 'inteiro' | 'decimal' | 'logico' | 'texto' | 'json';

function tipoDe(valores: readonly unknown[]): TipoInferido {
  const presentes = valores.filter((v) => v !== null && v !== undefined);
  if (presentes.length === 0) return 'texto';
  if (presentes.every((v) => typeof v === 'boolean')) return 'logico';
  if (presentes.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'inteiro';
  if (presentes.every((v) => typeof v === 'number')) return 'decimal';
  if (presentes.some((v) => typeof v === 'object')) return 'json';
  return 'texto';
}

const TIPOS: Record<string, Record<TipoInferido, string>> = {
  postgres: { inteiro: 'bigint', decimal: 'double precision', logico: 'boolean', texto: 'text', json: 'jsonb' },
  mysql: { inteiro: 'BIGINT', decimal: 'DOUBLE', logico: 'BOOLEAN', texto: 'TEXT', json: 'JSON' },
  // No SQL Server, o "AS JSON" vai DEPOIS do caminho (ver tabelaDe).
  sqlserver: { inteiro: 'bigint', decimal: 'float', logico: 'bit', texto: 'nvarchar(max)', json: 'nvarchar(max)' },
};

/** O caminho JSON de uma chave, entre aspas: aguenta espaço e acento no nome. */
const caminhoJson = (c: string): string => `$.${JSON.stringify(c)}`.replace(/'/g, "''");

function tabelaDe(nome: string, valor: unknown, dialeto: string, marcar: (v: ValorDeParametro) => string): string {
  if (!Array.isArray(valor)) {
    throw new Error(`{{${nome}}} depois de FROM/JOIN vira tabela, e pede uma LISTA; "${nome}" não é.`);
  }
  if (valor.length === 0) {
    throw new Error(`{{${nome}}} está vazia: sem itens, não dá para saber as colunas da tabela.`);
  }
  // Lista de valores simples: a coluna "valor".
  const linhas: Record<string, unknown>[] = valor.every(ehRegistro)
    ? (valor as Record<string, unknown>[])
    : valor.map((v: unknown) => ({ valor: v }));
  const colunas: string[] = [];
  for (const l of linhas) for (const c of Object.keys(l)) if (!colunas.includes(c)) colunas.push(c);
  const tipos = colunas.map((c) => tipoDe(linhas.map((l) => l[c])));
  const marcador = marcar(JSON.stringify(linhas));

  if (dialeto === 'postgres') {
    const defs = colunas.map((c, i) => `${JSON.stringify(c)} ${TIPOS.postgres[tipos[i]]}`).join(', ');
    return `(SELECT * FROM json_to_recordset(${marcador}::json) AS _t(${defs}))`;
  }
  if (dialeto === 'mysql' || dialeto === 'mariadb') {
    const defs = colunas
      .map((c, i) => `\`${c.replace(/`/g, '``')}\` ${TIPOS.mysql[tipos[i]]} PATH '${caminhoJson(c)}'`)
      .join(', ');
    return `(SELECT * FROM JSON_TABLE(${marcador}, '$[*]' COLUMNS (${defs})) AS _t)`;
  }
  if (dialeto === 'sqlserver') {
    const defs = colunas
      .map((c, i) =>
        `[${c.replace(/]/g, ']]')}] ${TIPOS.sqlserver[tipos[i]]} '${caminhoJson(c)}'${tipos[i] === 'json' ? ' AS JSON' : ''}`)
      .join(', ');
    return `(SELECT * FROM OPENJSON(${marcador}) WITH (${defs}))`;
  }
  const defs = colunas.map((c) => `json_extract(value, '${caminhoJson(c)}') AS ${JSON.stringify(c)}`).join(', ');
  return `(SELECT ${defs} FROM json_each(${marcador}))`;
}
