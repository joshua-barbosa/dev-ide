// Tradução do que o usuário digita para um padrão de `LIKE`.
//
// A regra de produto que vale registrar: **sem curinga, vira "contém"**.
// Digitar `alunos` procura `%alunos%`, porque é o que se espera ao lembrar um
// pedaço do nome. Com curinga (`tiraduvidas_%`), vale exatamente o que foi
// escrito — as regras do `LIKE`, que é o formato que o usuário já usa no MySQL.
//
// Isso mora aqui, e não no driver, porque é decisão de produto e não de banco:
// os três drivers precisam concordar, e a regra erra fácil.

/** Curingas do `LIKE`. `\` não entra: nem todo banco o trata igual por padrão. */
const CURINGAS = /[%_]/;

/**
 * Devolve o padrão pronto para ir **como parâmetro** de um `LIKE`.
 *
 * Nunca concatene o retorno no texto da consulta: o valor vem do usuário, e
 * ligá-lo é o que impede que `'; DROP` signifique alguma coisa.
 *
 * `null` quando não há filtro — é o que faz a listagem voltar ao normal.
 */
export function padraoDeFiltro(bruto: string): string | null {
  const texto = bruto.trim();
  if (texto === '') return null;
  return CURINGAS.test(texto) ? texto : `%${texto}%`;
}

/** Verdadeiro quando há filtro em vigor. Usado para sinalizar no nó. */
export function temFiltro(bruto: string | null | undefined): boolean {
  return typeof bruto === 'string' && bruto.trim() !== '';
}

/**
 * Detalhe do nó de categoria: "12 de 92" quando filtrado, "92" quando não.
 *
 * Mostrar o total junto é o que impede a pergunta "cadê a tabela?" — sem ele,
 * um filtro esquecido parece objeto sumido.
 */
export function detalheDaCategoria(achados: number, total: number | null): string {
  if (total === null || total === achados) return String(achados);
  return `${achados} de ${total}`;
}
