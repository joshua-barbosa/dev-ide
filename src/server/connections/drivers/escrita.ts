// O SQL de escrita da grade (spec 044).
//
// É a peça mais perigosa desta IDE. Todas as specs anteriores ou liam, ou
// mexiam em arquivo do usuário; esta manda `UPDATE` e `DELETE` para bancos de
// produção. Por isso ela é lógica pura, testada sem nenhum banco de pé, e por
// isso cada regra abaixo tem um comentário dizendo o que ela impede.
//
// **Três invariantes que não se negociam:**
//
// 1. **Nome de coluna vem da TELA** e é conferido contra as colunas reais antes
//    de virar identificador citado. Não dá para parametrizar identificador.
// 2. **Valor NUNCA entra no SQL.** Vai como parâmetro, sempre, sem exceção.
// 3. **O `WHERE` leva a chave E o valor antigo.** É o que detecta alteração
//    concorrente sem trava nenhuma: se ninguém casar, alguém mexeu na linha
//    entre a leitura e a gravação, e a transação é desfeita.
import { quoteIdentifier, type QuoteStyle } from './sql-base';
import type { CellValue } from '../../../shared/contracts';

/**
 * Teto de linhas por gravação.
 *
 * Não é limite de recurso, é rede de proteção: um rascunho com dez mil linhas
 * quase certamente é engano — seleção acidental, script mal escrito — e não
 * alguém editando à mão.
 */
export const MAX_LINHAS_POR_GRAVACAO = 500;

export interface ColunaDeEscrita {
  readonly name: string;
  readonly chave: boolean;
}

export type ValoresDeLinha = Readonly<Record<string, CellValue>>;

export interface Alteracao {
  readonly chave: ValoresDeLinha;
  /** Os valores como estavam quando a página foi lida. Entram no `WHERE`. */
  readonly antes: ValoresDeLinha;
  readonly depois: ValoresDeLinha;
}

export interface Remocao {
  readonly chave: ValoresDeLinha;
}

export interface Escrita {
  readonly insercoes: readonly ValoresDeLinha[];
  readonly alteracoes: readonly Alteracao[];
  readonly remocoes: readonly Remocao[];
}

export interface AlvoDeEscrita {
  /** Nome já qualificado e citado. */
  readonly alvo: string;
  readonly colunas: readonly ColunaDeEscrita[];
  readonly estilo: QuoteStyle;
  readonly marcador?: 'interrogacao' | 'numerado';
}

export interface ComandoDeEscrita {
  readonly sql: string;
  readonly params: readonly CellValue[];
  /**
   * O comando precisa afetar exatamente uma linha.
   *
   * `UPDATE` e `DELETE` apontam UMA linha pela chave. Zero significa que ela
   * mudou por baixo (ou sumiu), e aí a transação inteira é desfeita.
   */
  readonly exigeUmaLinha: boolean;
}

export interface PlanoDeEscrita {
  readonly comandos: readonly ComandoDeEscrita[];
}

function ehValor(bruto: unknown): bruto is CellValue {
  return (
    bruto === null ||
    typeof bruto === 'string' ||
    typeof bruto === 'number' ||
    typeof bruto === 'boolean'
  );
}

/** Lê um mapa coluna → valor, conferindo cada nome contra as colunas reais. */
function lerValores(
  bruto: unknown,
  colunas: readonly ColunaDeEscrita[],
  onde: string
): ValoresDeLinha {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const saida: Record<string, CellValue> = {};
  for (const [nome, valor] of Object.entries(r)) {
    if (!colunas.some((c) => c.name === nome)) {
      throw new Error(`Coluna desconhecida em ${onde}: ${JSON.stringify(nome)}.`);
    }
    if (!ehValor(valor)) {
      throw new Error(`Valor inválido para "${nome}" em ${onde}.`);
    }
    saida[nome] = valor;
  }
  return saida;
}

/**
 * Confere que a chave veio INTEIRA.
 *
 * Chave composta com um pedaço só apontaria várias linhas — e o `UPDATE`
 * mexeria em todas elas achando que mexia numa.
 */
function exigirChaveCompleta(
  chave: ValoresDeLinha,
  chaves: readonly ColunaDeEscrita[]
): void {
  for (const c of chaves) {
    if (!(c.name in chave)) {
      throw new Error(`A chave primária precisa vir inteira: falta "${c.name}".`);
    }
  }
}

export function normalizarEscrita(
  bruto: unknown,
  colunas: readonly ColunaDeEscrita[]
): Escrita {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const chaves = colunas.filter((c) => c.chave);

  const insercoesBrutas = Array.isArray(r.insercoes) ? r.insercoes : [];
  const alteracoesBrutas = Array.isArray(r.alteracoes) ? r.alteracoes : [];
  const remocoesBrutas = Array.isArray(r.remocoes) ? r.remocoes : [];

  const totais = insercoesBrutas.length + alteracoesBrutas.length + remocoesBrutas.length;
  if (totais > MAX_LINHAS_POR_GRAVACAO) {
    throw new Error(
      `São ${totais} linhas numa gravação só, e o limite é ${MAX_LINHAS_POR_GRAVACAO}.`
    );
  }

  // Alterar e apagar exigem apontar UMA linha. Sem chave primária não há como.
  // Inserir não exige — o banco gera a chave.
  if (chaves.length === 0 && (alteracoesBrutas.length > 0 || remocoesBrutas.length > 0)) {
    throw new Error(
      'Esta tabela não declara chave primária, então não há como apontar uma linha só.'
    );
  }

  const insercoes = insercoesBrutas.map((i) => lerValores(i, colunas, 'inserção'));

  const alteracoes = alteracoesBrutas.map((a) => {
    const item = (a ?? {}) as Record<string, unknown>;
    const chave = lerValores(item.chave, colunas, 'chave');
    exigirChaveCompleta(chave, chaves);
    const depois = lerValores(item.depois, colunas, 'alteração');
    // A chave fica FORA do SET: trocar a chave da mesma linha que se está
    // achando por ela é o caminho mais curto para um estrago.
    for (const nome of Object.keys(depois)) {
      if (chaves.some((c) => c.name === nome)) {
        throw new Error(`A coluna "${nome}" é chave primária e não pode ser alterada aqui.`);
      }
    }
    return { chave, antes: lerValores(item.antes, colunas, 'alteração'), depois };
  });

  const remocoes = remocoesBrutas.map((d) => {
    const chave = lerValores((d ?? ({} as Record<string, unknown>)).chave, colunas, 'chave');
    exigirChaveCompleta(chave, chaves);
    return { chave };
  });

  return { insercoes, alteracoes, remocoes };
}

/** Monta o `WHERE` de uma linha: a chave, mais os valores antigos das alteradas. */
function condicoes(
  valores: ValoresDeLinha,
  estilo: QuoteStyle,
  params: CellValue[],
  proximoMarcador: () => string
): string[] {
  return Object.entries(valores).map(([nome, valor]) => {
    const coluna = quoteIdentifier(nome, estilo);
    if (valor === null) {
      // `coluna = NULL` NUNCA casa, nem quando a coluna é nula — e o UPDATE
      // afetaria zero linhas, fazendo a IDE acusar conflito onde não há.
      return `${coluna} IS NULL`;
    }
    params.push(valor);
    return `${coluna} = ${proximoMarcador()}`;
  });
}

export function montarEscrita(alvo: AlvoDeEscrita, escrita: Escrita): PlanoDeEscrita {
  const numerado = alvo.marcador === 'numerado';
  const comandos: ComandoDeEscrita[] = [];

  const novoComando = (): { params: CellValue[]; marcador: () => string } => {
    const params: CellValue[] = [];
    return { params, marcador: () => (numerado ? `$${params.length}` : '?') };
  };

  // A ordem importa: apagar primeiro libera chave única para um INSERT que a
  // reaproveite na mesma gravação.
  for (const r of escrita.remocoes) {
    const { params, marcador } = novoComando();
    const onde = condicoes(r.chave, alvo.estilo, params, marcador);
    comandos.push({
      sql: `DELETE FROM ${alvo.alvo}\n WHERE ${onde.join(' AND ')}`,
      params,
      exigeUmaLinha: true,
    });
  }

  for (const a of escrita.alteracoes) {
    const { params, marcador } = novoComando();
    const sets = Object.entries(a.depois).map(([nome, valor]) => {
      params.push(valor);
      return `${quoteIdentifier(nome, alvo.estilo)} = ${marcador()}`;
    });
    if (sets.length === 0) continue;

    // O `WHERE` leva a chave E o valor antigo de cada coluna alterada: é o que
    // faz alteração concorrente virar "zero linhas" em vez de sobrescrita.
    const onde = [
      ...condicoes(a.chave, alvo.estilo, params, marcador),
      ...condicoes(
        Object.fromEntries(Object.keys(a.depois).map((n) => [n, a.antes[n] ?? null])),
        alvo.estilo,
        params,
        marcador
      ),
    ];
    comandos.push({
      sql: `UPDATE ${alvo.alvo}\n   SET ${sets.join(', ')}\n WHERE ${onde.join(' AND ')}`,
      params,
      exigeUmaLinha: true,
    });
  }

  for (const i of escrita.insercoes) {
    // Só as colunas preenchidas: mandar as vazias como NULL sobrescreveria o
    // DEFAULT que a coluna declara.
    const nomes = Object.keys(i);
    if (nomes.length === 0) continue;
    const { params, marcador } = novoComando();
    const marcas = nomes.map((nome) => {
      params.push(i[nome] ?? null);
      return marcador();
    });
    comandos.push({
      sql:
        `INSERT INTO ${alvo.alvo} ` +
        `(${nomes.map((n) => quoteIdentifier(n, alvo.estilo)).join(', ')})\n` +
        `VALUES (${marcas.join(', ')})`,
      params,
      // O banco pode gerar mais de uma linha? Não num INSERT de valores. Mas
      // exigir exatamente uma aqui não acrescenta proteção, e um `INSERT ...
      // ON DUPLICATE` de um driver futuro poderia afetar duas.
      exigeUmaLinha: false,
    });
  }

  return { comandos };
}
