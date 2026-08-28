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
//
// **Corpo de rotina (T052, spec 071).** Num `CREATE PROCEDURE … BEGIN … END`, o
// `;` de dentro NÃO termina o comando. O cliente `mysql` resolve isso com
// `DELIMITER`, que é comando DELE e não do servidor; aqui se resolve contando
// `BEGIN`/`END`, que é o que o texto já diz. A nota dele na triagem: *"hoje o
// quebrador parte DENTRO do corpo e manda meia query, calado"*.

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

/** A palavra que começa exatamente em `i`, em maiúsculas, ou `null`. */
function palavraEm(texto: string, i: number): string | null {
  const anterior = i === 0 ? '' : (texto[i - 1] ?? '');
  // Meio de palavra não conta: `beginner` não abre bloco, e `x.end` não fecha.
  if (/[A-Za-z0-9_$]/.test(anterior)) return null;
  if (!/[A-Za-z]/.test(texto[i] ?? '')) return null;
  let j = i;
  while (j < texto.length && /[A-Za-z0-9_]/.test(texto[j] ?? '')) j += 1;
  return texto.slice(i, j).toUpperCase();
}

/**
 * A próxima palavra depois de `i`, com onde ela TERMINA.
 *
 * O fim importa: quem lê `END CASE` precisa consumir o `CASE` junto, senão ele
 * é lido de novo no laço seguinte e conta como um `CASE` novo — o corpo nunca
 * fecha, e o arquivo inteiro vira um statement só. Custou um teste vermelho.
 */
function proximaPalavra(texto: string, i: number): { palavra: string; fim: number } | null {
  let j = i;
  while (j < texto.length && /\s/.test(texto[j] ?? '')) j += 1;
  const palavra = palavraEm(texto, j);
  return palavra === null ? null : { palavra, fim: j + palavra.length };
}

/**
 * O statement que começou aqui é uma DEFINIÇÃO de rotina?
 *
 * Só nelas o `BEGIN` abre corpo. Sem esta pergunta, um `BEGIN;` de transação
 * abriria um bloco que nunca fecha — e o arquivo inteiro viraria um statement
 * só, calado, que é o mesmo defeito com o sinal trocado.
 */
const ABRE_CORPO = /\bCREATE\b[\s\S]*?\b(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i;

/**
 * Fechamentos que pertencem a OUTRA construção.
 *
 * `END IF`, `END LOOP`, `END WHILE` e `END REPEAT` fecham o que os abriu — e os
 * abridores não são contados. Só o `END` sozinho (e o `END CASE`, que fecha o
 * `CASE` contado) desce um nível.
 */
const FECHAM_OUTRA_COISA = new Set(['IF', 'LOOP', 'WHILE', 'REPEAT']);

/** Palavras que pertencem ao `END` que as precede, e são consumidas com ele. */
const GRUDAM_NO_END = new Set([...FECHAM_OUTRA_COISA, 'CASE']);

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
  /** Quantos `BEGIN`/`CASE` estão abertos no statement em curso (T052). */
  let profundidade = 0;

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
    // O statement acabou: a conta de blocos recomeça do zero. Sem isto, um
    // corpo mal formado contaminaria todo o resto do arquivo.
    profundidade = 0;
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
          // Dentro de um corpo, o `;` separa comandos do corpo — não termina o
          // `CREATE`. É toda a correção do T052.
          if (profundidade === 0 && !fechar(i, i + 1)) return { statements, truncado };
        } else {
          const palavra = palavraEm(fonte, i);
          if (palavra !== null) {
            if (palavra === 'BEGIN') {
              // Fora de rotina, `BEGIN` é transação: não abre corpo nenhum.
              if (profundidade > 0 || ABRE_CORPO.test(fonte.slice(inicio, i))) profundidade += 1;
            } else if (palavra === 'CASE' && profundidade > 0) {
              // Contado porque o `CASE` de EXPRESSÃO fecha com `END` pelado —
              // o mesmo `END` do bloco. Sem contá-lo, o corpo fecharia cedo.
              profundidade += 1;
            } else if (palavra === 'END' && profundidade > 0) {
              const seguinte = proximaPalavra(fonte, i + palavra.length);
              const nome = seguinte?.palavra ?? null;
              if (nome === null || !FECHAM_OUTRA_COISA.has(nome)) profundidade -= 1;
              if (seguinte !== null && GRUDAM_NO_END.has(seguinte.palavra)) {
                // O `CASE` de `END CASE` é DAQUELE `END`: consumido junto, para
                // não ser contado como abertura no giro seguinte.
                i = seguinte.fim - 1;
                break;
              }
            }
            // Pular a palavra inteira: assim o `-1` do laço não a relê pelo
            // meio, e `END` dentro de `APPEND` nunca é visto.
            i += palavra.length - 1;
          }
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
