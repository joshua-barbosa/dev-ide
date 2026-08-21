// Quebra um arquivo SQL em statements.
//
// É a peça mais fácil de errar da spec 038, e a única onde o erro é silencioso:
// partir no `;` errado NÃO dá erro de sintaxe — manda meia query para o banco.
// Por isso mora aqui, em lógica pura, com os casos difíceis virados teste antes
// de existir uma linha de interface.
//
// Varredor de um caractere por vez, com um estado só. Sem regex: expressão
// regular não sabe contar aninhamento nem lembrar o rótulo de um `$corpo$`, e é
// exatamente assim que implementações ingênuas disto se quebram.

/** Teto de statements por arquivo. Acima disto a quebra para e avisa. */
export const MAX_STATEMENTS = 500;

export interface Statement {
  /** O texto sem o `;` terminador e sem o espaço em volta. */
  readonly texto: string;
  /** Índice em caracteres no texto original, para recortar de volta. */
  readonly inicio: number;
  readonly fim: number;
  /** Linha da primeira e da última linha com conteúdo, contando de 1. */
  readonly linhaInicio: number;
  readonly linhaFim: number;
}

export interface Quebra {
  readonly statements: readonly Statement[];
  /** Bateu no teto: a lista está cortada, e quem mostra precisa dizer isso. */
  readonly truncado: boolean;
}

type Estado =
  | { readonly tipo: 'fora' }
  | { readonly tipo: 'aspaSimples' }
  | { readonly tipo: 'aspaDupla' }
  | { readonly tipo: 'crase' }
  | { readonly tipo: 'comentarioLinha' }
  | { readonly tipo: 'comentarioBloco' }
  | { readonly tipo: 'dolar'; readonly marca: string };

const FORA: Estado = { tipo: 'fora' };

/**
 * Lê um abridor de bloco de dólar em `i`, se houver.
 *
 * `$$` e `$corpo$` abrem; `$1` e `$` solto, não — no PostgreSQL `$1` é
 * parâmetro, e tratá-lo como abertura engoliria o resto do arquivo.
 */
function marcaDeDolar(texto: string, i: number): string | null {
  if (texto[i] !== '$') return null;
  let j = i + 1;
  while (j < texto.length && /[A-Za-z0-9_]/.test(texto[j] ?? '')) j += 1;
  return texto[j] === '$' ? texto.slice(i, j + 1) : null;
}

/**
 * O trecho tem algo para executar?
 *
 * Espaço e comentário não têm — e oferecer um `Run` sobre o cabeçalho de um
 * arquivo seria um botão que não faz nada.
 */
function temConteudo(bruto: string): boolean {
  let estado: Estado = FORA;
  for (let i = 0; i < bruto.length; i += 1) {
    const c = bruto[i] ?? '';
    const prox = bruto[i + 1] ?? '';

    if (estado.tipo === 'comentarioLinha') {
      if (c === '\n') estado = FORA;
      continue;
    }
    if (estado.tipo === 'comentarioBloco') {
      if (c === '*' && prox === '/') {
        estado = FORA;
        i += 1;
      }
      continue;
    }
    if (c === '-' && prox === '-') {
      estado = { tipo: 'comentarioLinha' };
      i += 1;
      continue;
    }
    if (c === '#') {
      estado = { tipo: 'comentarioLinha' };
      continue;
    }
    if (c === '/' && prox === '*') {
      estado = { tipo: 'comentarioBloco' };
      i += 1;
      continue;
    }
    if (!/\s/.test(c)) return true;
  }
  return false;
}

/**
 * Recorta o trecho, tira o espaço das pontas e calcula as linhas.
 *
 * Devolve `null` quando não sobrou nada executável — o chamador simplesmente
 * não acrescenta o statement.
 */
function montar(fonte: string, inicioBruto: number, fimBruto: number, linhaDoInicio: number):
  Statement | null {
  const bruto = fonte.slice(inicioBruto, fimBruto);
  if (!temConteudo(bruto)) return null;

  const espacoEsquerda = bruto.length - bruto.trimStart().length;
  const texto = bruto.trim();
  const inicio = inicioBruto + espacoEsquerda;
  const fim = inicio + texto.length;

  // A linha do início é a do primeiro caractere com conteúdo, e não a do `;`
  // anterior — senão o CodeLens apareceria sobre uma linha em branco.
  let linhaInicio = linhaDoInicio;
  for (let i = inicioBruto; i < inicio; i += 1) {
    if (fonte[i] === '\n') linhaInicio += 1;
  }
  let linhaFim = linhaInicio;
  for (let i = inicio; i < fim; i += 1) {
    if (fonte[i] === '\n') linhaFim += 1;
  }
  return { texto, inicio, fim, linhaInicio, linhaFim };
}

export function quebrarEmStatements(fonte: string): Quebra {
  const statements: Statement[] = [];
  let estado: Estado = FORA;
  let inicio = 0;
  let linhaDoInicio = 1;
  let truncado = false;

  const fechar = (fimBruto: number, proximoInicio: number): boolean => {
    const s = montar(fonte, inicio, fimBruto, linhaDoInicio);
    if (s !== null) {
      if (statements.length >= MAX_STATEMENTS) {
        truncado = true;
        return false;
      }
      statements.push(s);
    }
    // A contagem de linhas do próximo trecho começa de onde este parou.
    for (let i = inicio; i < proximoInicio; i += 1) {
      if (fonte[i] === '\n') linhaDoInicio += 1;
    }
    inicio = proximoInicio;
    return true;
  };

  for (let i = 0; i < fonte.length; i += 1) {
    const c = fonte[i] ?? '';
    const prox = fonte[i + 1] ?? '';

    switch (estado.tipo) {
      case 'aspaSimples':
      case 'aspaDupla':
      case 'crase': {
        const fechamento = estado.tipo === 'aspaSimples' ? "'" : estado.tipo === 'aspaDupla' ? '"' : '`';
        // Barra invertida escapa o próximo caractere: `'a\'b'` é UM literal.
        if (c === '\\') {
          i += 1;
          break;
        }
        if (c === fechamento) {
          // Duplicar o fechamento também escapa: `'it''s'` é UM literal.
          if (prox === fechamento) i += 1;
          else estado = FORA;
        }
        break;
      }

      case 'comentarioLinha':
        if (c === '\n') estado = FORA;
        break;

      case 'comentarioBloco':
        if (c === '*' && prox === '/') {
          estado = FORA;
          i += 1;
        }
        break;

      case 'dolar':
        if (c === '$' && fonte.startsWith(estado.marca, i)) {
          i += estado.marca.length - 1;
          estado = FORA;
        }
        break;

      case 'fora': {
        if (c === "'") estado = { tipo: 'aspaSimples' };
        else if (c === '"') estado = { tipo: 'aspaDupla' };
        else if (c === '`') estado = { tipo: 'crase' };
        else if (c === '#') estado = { tipo: 'comentarioLinha' };
        else if (c === '-' && prox === '-') {
          estado = { tipo: 'comentarioLinha' };
          i += 1;
        } else if (c === '/' && prox === '*') {
          estado = { tipo: 'comentarioBloco' };
          i += 1;
        } else if (c === '$') {
          const marca = marcaDeDolar(fonte, i);
          if (marca !== null) {
            estado = { tipo: 'dolar', marca };
            i += marca.length - 1;
          }
        } else if (c === ';') {
          // O `;` fica de fora do texto e de fora do próximo trecho.
          if (!fechar(i, i + 1)) return { statements, truncado };
        }
        break;
      }
    }
  }

  // O resto depois do último `;` é statement, terminador ou não (AC-21).
  fechar(fonte.length, fonte.length);
  return { statements, truncado };
}

/** Qual statement contém a linha dada, se algum. */
export function statementNaLinha(
  statements: readonly Statement[],
  linha: number
): Statement | null {
  return statements.find((s) => linha >= s.linhaInicio && linha <= s.linhaFim) ?? null;
}
