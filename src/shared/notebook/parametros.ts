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

type Parte = { readonly texto: string } | { readonly nome: string };

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
      const nome = fim === -1 ? '' : sql.slice(i + 2, fim).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) {
        if (texto !== '') saida.push({ texto });
        texto = '';
        saida.push({ nome });
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

function comoParametro(v: unknown): ValorDeParametro {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
}

export function montarSqlComParametros(
  sql: string,
  valores: Readonly<Record<string, unknown>>,
  estilo: EstiloDeParametro
): { readonly sql: string; readonly params: ValorDeParametro[] } {
  const params: ValorDeParametro[] = [];
  const marcador = (): string => {
    const n = params.length;
    return estilo === 'dolar' ? `$${n}` : estilo === 'arroba' ? `@p${n}` : '?';
  };
  let saida = '';
  for (const p of partes(sql)) {
    if ('texto' in p) {
      saida += p.texto;
      continue;
    }
    if (!(p.nome in valores)) {
      throw new Error(`{{${p.nome}}}: a variável "${p.nome}" não existe no kernel. Rode antes a célula que a cria.`);
    }
    const valor = valores[p.nome];
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
