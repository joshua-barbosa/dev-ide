// O SQL que busca o valor INTEIRO de uma célula (spec 062, fase D).
//
// Por que existe: a grade corta cada célula em `MAX_CELL_CHARS` — uma página de
// 500 linhas com um JSON de 40 KB em cada uma seriam 20 MB atravessando a rede
// para caber em colunas de 400 px. Só que a lupa promete "o valor inteiro", e
// estava entregando o cortado, com as reticências do servidor no fim. Ele achou
// usando: o JSON de um simulado parava no meio de `"nota":…`.
//
// As mesmas três invariantes da escrita valem aqui, e pela mesma razão — este
// SQL também é montado a partir de nome que veio da tela:
//
// 1. Nome de coluna é conferido contra as colunas REAIS antes de virar
//    identificador citado. Não dá para parametrizar identificador.
// 2. Valor nunca entra no SQL: vai como parâmetro, sempre.
// 3. O `WHERE` é a chave primária inteira — sem ela não há como apontar uma
//    linha só, e trazer a errada seria pior que não trazer nenhuma.
import { quoteIdentifier } from './sql-base';
import type { AlvoDeEscrita, ValoresDeLinha } from './escrita';
import type { CellValue } from '../../../shared/contracts';

export interface ComandoDeCelula {
  readonly sql: string;
  readonly params: readonly CellValue[];
}

/**
 * O teto do VISOR — bem mais alto que o da grade, mas ainda um teto.
 *
 * Um `blob` de 500 MB mataria a aba do navegador, e "a IDE travou" é resposta
 * pior que "este valor tem 500 MB". O visor diz quando cortou.
 */
export const MAX_CELULA_CHARS = 2_000_000;

function marcador(estilo: AlvoDeEscrita['marcador'], indice: number): string {
  return estilo === 'numerado' ? `$${indice + 1}` : '?';
}

export function montarLeituraDeCelula(
  alvo: AlvoDeEscrita,
  coluna: string,
  chave: ValoresDeLinha
): ComandoDeCelula {
  const conhecidas = new Set(alvo.colunas.map((c) => c.name));
  if (!conhecidas.has(coluna)) {
    throw new Error(`Coluna desconhecida: ${JSON.stringify(coluna)}.`);
  }

  const chaves = alvo.colunas.filter((c) => c.chave).map((c) => c.name);
  if (chaves.length === 0) {
    throw new Error('Esta tabela não declara chave primária, então não há como apontar uma linha só.');
  }

  // A chave que chegou precisa cobrir a chave REAL — nem a mais, nem a menos.
  // A menos, o `WHERE` casaria com várias linhas; a mais, alguém está mandando
  // coluna que não é chave e o pedido não é o que parece.
  const recebidas = Object.keys(chave);
  const faltando = chaves.filter((c) => !recebidas.includes(c));
  if (faltando.length > 0) {
    throw new Error(`Faltou a chave: ${faltando.join(', ')}.`);
  }
  const sobrando = recebidas.filter((c) => !chaves.includes(c));
  if (sobrando.length > 0) {
    throw new Error(`Não é chave: ${sobrando.join(', ')}.`);
  }

  const params: CellValue[] = [];
  const where = chaves
    .map((c) => {
      const valor = chave[c] ?? null;
      // `IS NULL` e não `= ?`: em SQL, `NULL = NULL` é desconhecido, e a linha
      // nunca casaria. Chave nula é rara mas existe em tabela mal modelada.
      if (valor === null) return `${quoteIdentifier(c, alvo.estilo)} IS NULL`;
      params.push(valor);
      return `${quoteIdentifier(c, alvo.estilo)} = ${marcador(alvo.marcador, params.length - 1)}`;
    })
    .join(' AND ');

  return {
    sql: `SELECT ${quoteIdentifier(coluna, alvo.estilo)} FROM ${alvo.alvo} WHERE ${where}`,
    params,
  };
}

/** Corta no teto do visor, dizendo em quanto — ou `null` quando não cortou. */
export function cortarParaOVisor(valor: CellValue): {
  readonly valor: CellValue;
  readonly cortadoEm: number | null;
} {
  if (typeof valor !== 'string' || valor.length <= MAX_CELULA_CHARS) {
    return { valor, cortadoEm: null };
  }
  return { valor: valor.slice(0, MAX_CELULA_CHARS), cortadoEm: MAX_CELULA_CHARS };
}
