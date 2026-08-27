// O filtro de uma categoria da árvore (T111 e T112, spec 069).
//
// Antes desta spec o filtro era UM texto — o padrão do nome — e vivia só na
// memória da aba. Agora tem quatro campos, sobrevive ao reinício, e por isso
// precisa de duas coisas que um texto solto não precisava: leitura tolerante do
// que veio do disco, e uma frase dizendo o que a IDE entendeu.
//
// Lógica pura, no `shared`, porque é ela que erra na prática: "10 MB" tem
// espaço, "1,5 GB" tem vírgula decimal, e "grande" não é tamanho nenhum. Um
// erro aqui filtra tabela demais ou de menos, calado.

/** O que se pode filtrar num nó. Quem declara é o NÓ, não a sessão. */
export type Criterio = 'nome' | 'dono' | 'tamanho' | 'data';

export interface FiltroDaArvore {
  /** Trecho do nome. Continua sendo o filtro de sempre. */
  readonly nome: string;
  readonly dono: string;
  /** Como o usuário digitou: `10 MB`, `1,5 GB`. */
  readonly tamanho: string;
  /** `2026-01-15` ou `30d` — os últimos trinta dias. */
  readonly desde: string;
}

export const FILTRO_VAZIO: FiltroDaArvore = { nome: '', dono: '', tamanho: '', desde: '' };

const UNIDADES: Readonly<Record<string, number>> = {
  '': 1,
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};

/**
 * Quantos bytes o usuário quis dizer, ou `null` se não deu para saber.
 *
 * `null` e não zero: "maior que 0 bytes" passa em toda tabela do banco, e o
 * usuário concluiria que o filtro está quebrado em vez de que a palavra que ele
 * digitou não é um tamanho.
 */
export function interpretarTamanho(texto: string): number | null {
  const limpo = texto.trim().toLowerCase().replace(',', '.');
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(limpo);
  if (m === null) return null;
  const fator = UNIDADES[m[2]];
  if (fator === undefined) return null;
  const valor = Number(m[1]) * fator;
  return Number.isFinite(valor) ? valor : null;
}

function ehDiaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const d = new Date(`${dia}T00:00:00Z`);
  // `new Date('2026-13-01')` não lança: devolve Invalid Date, ou pior, rola o
  // mês para o ano seguinte. Comparar de volta é o que pega os dois casos.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

/**
 * A data-limite, sempre como `AAAA-MM-DD`.
 *
 * `agora` vem de fora para isto continuar sendo função pura — e para o teste
 * poder afirmar que `30d` em 27/08 é 28/07, em vez de recalcular a mesma conta
 * que está sendo testada.
 */
export function interpretarData(texto: string, agora: Date): string | null {
  const limpo = texto.trim().toLowerCase();
  if (limpo === '') return null;
  const relativo = /^(\d+)d$/.exec(limpo);
  if (relativo !== null) {
    const dias = Number(relativo[1]);
    const alvo = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
    return alvo.toISOString().slice(0, 10);
  }
  return ehDiaValido(limpo) ? limpo : null;
}

function texto(bruto: unknown): string {
  return typeof bruto === 'string' ? bruto.trim() : '';
}

/** Leitura tolerante: arquivo estragado vale como "sem filtro", nunca exceção. */
export function normalizarFiltro(bruto: unknown): FiltroDaArvore {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return FILTRO_VAZIO;
  const lido = bruto as Record<string, unknown>;
  return {
    nome: texto(lido.nome),
    dono: texto(lido.dono),
    tamanho: texto(lido.tamanho),
    desde: texto(lido.desde),
  };
}

export function estaVazio(filtro: FiltroDaArvore): boolean {
  return filtro.nome === '' && filtro.dono === '' && filtro.tamanho === '' && filtro.desde === '';
}

/**
 * A frase que a tela mostra.
 *
 * É a lição da spec 063: o filtro que esconde dado precisa dizer em português o
 * que entendeu, senão "sumiu tudo" vira defeito procurado no lugar errado. E o
 * que NÃO foi entendido aparece como não entendido — não some calado.
 */
export function explicarFiltro(filtro: FiltroDaArvore, agora: Date): string {
  const partes: string[] = [];
  if (filtro.nome !== '') partes.push(`nome contém "${filtro.nome}"`);
  if (filtro.dono !== '') partes.push(`dono é "${filtro.dono}"`);
  if (filtro.tamanho !== '') {
    const bytes = interpretarTamanho(filtro.tamanho);
    partes.push(
      bytes === null
        ? `tamanho não entendido: "${filtro.tamanho}"`
        : `maior que ${filtro.tamanho}`
    );
  }
  if (filtro.desde !== '') {
    const dia = interpretarData(filtro.desde, agora);
    partes.push(dia === null ? `data não entendida: "${filtro.desde}"` : `mexida desde ${dia}`);
  }
  return partes.length === 0 ? 'sem filtro' : partes.join(' · ');
}
