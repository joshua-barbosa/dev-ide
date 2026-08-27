// Ler gatilho e checagem do TEXTO do SQLite (T063, spec 069).
//
// O SQLite não tem catálogo de restrição: a checagem mora dentro do texto do
// `CREATE TABLE`, e o gatilho, inteiro, no `sqlite_master`. A desculpa que
// escrevi na spec 045 foi *"exige interpretar o texto do CREATE TRIGGER"* —
// verdade, e é o que este arquivo faz.
//
// A técnica é a mesma que a spec 068 usou para achar o separador do CSV:
// **mascarar** o que é literal e comentário, e só então procurar. Uma expressão
// regular no texto cru acharia `CHECK` dentro de uma string ou de um comentário
// — e essa é a classe de erro que faz a tela afirmar o que não existe.
//
// Onde a varredura não tiver certeza, a resposta é `naoSei` com o motivo, e não
// lista vazia: é a distinção da spec 045, e é ela que impede a tela de dizer
// "esta tabela não tem checagem" quando o certo é "eu não consegui ler".

export interface GatilhoLido {
  readonly nome: string;
  readonly momento: string;
  readonly evento: string;
  readonly orientacao: string | null;
  readonly corpo: string;
}

export interface ChecagemLida {
  readonly nome: string;
  readonly expressao: string;
}

/**
 * Devolve o texto com literais e comentários trocados por espaços.
 *
 * Mesmo comprimento, então toda posição achada na máscara vale no original —
 * é isso que permite procurar na máscara e recortar do texto de verdade.
 */
export function mascarar(texto: string): string {
  const saida = texto.split('');
  let i = 0;
  const apagar = (ate: number): void => {
    for (let k = i; k < ate && k < saida.length; k += 1) {
      // A quebra de linha fica: ela separa comandos e ajuda a contar linha.
      if (saida[k] !== '\n') saida[k] = ' ';
    }
  };

  while (i < texto.length) {
    const c = texto[i];
    if (c === '-' && texto[i + 1] === '-') {
      const fim = texto.indexOf('\n', i);
      const ate = fim === -1 ? texto.length : fim;
      apagar(ate);
      i = ate;
      continue;
    }
    if (c === '/' && texto[i + 1] === '*') {
      const fim = texto.indexOf('*/', i + 2);
      const ate = fim === -1 ? texto.length : fim + 2;
      apagar(ate);
      i = ate;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      // Aspa dobrada é a própria aspa, e não o fim — `'não''sei'` é um literal só.
      let j = i + 1;
      while (j < texto.length) {
        if (texto[j] === c) {
          if (texto[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      const ate = Math.min(j + 1, texto.length);
      apagar(ate);
      i = ate;
      continue;
    }
    if (c === '[') {
      const fim = texto.indexOf(']', i + 1);
      const ate = fim === -1 ? texto.length : fim + 1;
      apagar(ate);
      i = ate;
      continue;
    }
    i += 1;
  }
  return saida.join('');
}

/** Onde fecha o parêntese aberto em `abre`, ou `-1` se ele nunca fecha. */
function fechamento(mascara: string, abre: number): number {
  let profundidade = 0;
  for (let i = abre; i < mascara.length; i += 1) {
    if (mascara[i] === '(') profundidade += 1;
    else if (mascara[i] === ')') {
      profundidade -= 1;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

/**
 * As palavras-chave, na máscara. O NOME não entra aqui de propósito.
 *
 * Um nome citado (`"tg x"`, `[tg x]`) some na máscara — é literal para ela. Se
 * o nome fizesse parte deste casamento, todo gatilho de nome citado deixaria de
 * ser reconhecido. Ele é recortado do texto ORIGINAL, entre as duas palavras.
 */
// Termina em fronteira de palavra, SEM consumir o espaço seguinte: um `\s+`
// no fim é guloso e engoliria também os espaços que a máscara deixou no lugar
// do nome citado — e aí o nome sairia vazio. Custou um teste vermelho.
const CABECA_DO_GATILHO =
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b(?:\s+IF\s+NOT\s+EXISTS\b)?/i;
const MOMENTO_E_EVENTO = /\b(BEFORE|AFTER|INSTEAD\s+OF)\s+(DELETE|INSERT|UPDATE)\b/i;

/** Tira aspas, colchetes e crases de um identificador do `sqlite_master`. */
function semCitacao(nome: string): string {
  const limpo = nome.trim();
  if (/^".*"$/.test(limpo)) return limpo.slice(1, -1).replace(/""/g, '"');
  if (/^`.*`$/.test(limpo)) return limpo.slice(1, -1).replace(/``/g, '`');
  if (/^\[.*\]$/.test(limpo)) return limpo.slice(1, -1);
  return limpo;
}

/**
 * Lê um `CREATE TRIGGER` do `sqlite_master`.
 *
 * `null` quando o texto não bate com a forma esperada — e aí quem chama devolve
 * `naoSei`, em vez de inventar um gatilho com campos em branco.
 */
export function lerGatilho(sql: string): GatilhoLido | null {
  const mascara = mascarar(sql);
  const cabeca = CABECA_DO_GATILHO.exec(mascara);
  if (cabeca === null) return null;
  const depoisDoNome = cabeca.index + cabeca[0].length;

  const quando = MOMENTO_E_EVENTO.exec(mascara.slice(depoisDoNome));
  if (quando === undefined || quando === null) return null;

  const nome = semCitacao(sql.slice(depoisDoNome, depoisDoNome + quando.index));
  if (nome === '') return null;

  // O corpo é do primeiro `BEGIN` até o último `END` — recortado do texto
  // ORIGINAL, para não devolver o corpo mascarado.
  const begin = /\bBEGIN\b/i.exec(mascara);
  const end = mascara.toUpperCase().lastIndexOf('END');
  const fimDoQuando = depoisDoNome + quando.index + quando[0].length;
  const corpo =
    begin === null || end <= begin.index
      ? sql.slice(fimDoQuando).trim()
      : sql.slice(begin.index + begin[0].length, end).trim();

  return {
    nome,
    momento: quando[1].toUpperCase().replace(/\s+/g, ' '),
    evento: quando[2].toUpperCase(),
    // O SQLite só tem gatilho de linha; `FOR EACH ROW` é opcional e implícito.
    orientacao: 'ROW',
    corpo,
  };
}

/**
 * Lê as checagens do texto de um `CREATE TABLE`.
 *
 * Pega as duas formas: a da COLUNA (`idade INTEGER CHECK (idade > 0)`) e a da
 * TABELA (`CONSTRAINT ck CHECK (a < b)`). Uma tabela pode ter as duas, e listar
 * só uma delas seria afirmar que a outra não existe.
 */
export function lerChecagens(
  createTable: string
): { readonly itens: readonly ChecagemLida[] } | { readonly naoSei: string } {
  const mascara = mascarar(createTable);
  const abre = mascara.indexOf('(');
  if (abre === -1) {
    return { naoSei: 'O DDL desta tabela não tem lista de colunas — nada a interpretar.' };
  }
  const fecha = fechamento(mascara, abre);
  if (fecha === -1) {
    return { naoSei: 'O DDL desta tabela tem parêntese sem par — a IDE não arrisca adivinhar.' };
  }

  const itens: ChecagemLida[] = [];
  let anonimas = 0;

  // Varre a lista de definições, quebrando por vírgula de PRIMEIRO nível.
  let inicio = abre + 1;
  let profundidade = 0;
  const pedacos: Array<[number, number]> = [];
  for (let i = abre + 1; i < fecha; i += 1) {
    const c = mascara[i];
    if (c === '(') profundidade += 1;
    else if (c === ')') profundidade -= 1;
    else if (c === ',' && profundidade === 0) {
      pedacos.push([inicio, i]);
      inicio = i + 1;
    }
  }
  pedacos.push([inicio, fecha]);

  for (const [de, ate] of pedacos) {
    const trecho = mascara.slice(de, ate);
    const achado = /\bCHECK\s*\(/i.exec(trecho);
    if (achado === null) continue;

    const abreExpr = de + achado.index + achado[0].length - 1;
    const fechaExpr = fechamento(mascara, abreExpr);
    if (fechaExpr === -1 || fechaExpr > ate) {
      return { naoSei: 'Uma checagem tem parêntese sem par no DDL desta tabela.' };
    }

    // O nome sai do texto ORIGINAL, entre `CONSTRAINT` e `CHECK`: citado, ele
    // não existe na máscara. Mesma razão do nome do gatilho.
    const constraint = /\bCONSTRAINT\s+/i.exec(trecho);
    anonimas += 1;
    let nome: string;
    if (constraint !== null && constraint.index < achado.index) {
      const de1 = de + constraint.index + constraint[0].length;
      nome = semCitacao(createTable.slice(de1, de + achado.index));
    } else {
      // Checagem de COLUNA: o nome da coluna é a melhor pista que existe.
      const primeiro = /^\s*\S+/.exec(trecho);
      const daColuna =
        primeiro === null || achado.index === 0
          ? ''
          : semCitacao(createTable.slice(de + primeiro.index, de + primeiro.index + primeiro[0].length));
      nome = daColuna === '' ? `check_${anonimas}` : `(coluna ${daColuna})`;
    }
    if (nome === '') nome = `check_${anonimas}`;

    itens.push({ nome, expressao: createTable.slice(abreExpr + 1, fechaExpr).trim() });
  }

  return { itens };
}
