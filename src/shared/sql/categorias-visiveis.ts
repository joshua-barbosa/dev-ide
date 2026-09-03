// Quais categorias da árvore aparecem NAQUELA conexão.
//
// Ele pediu em 03/09/2026: *"precisava ter um checkbox no cadastro do banco de
// dados para ativar a visualização ou não naquela conexão"*, falando de Type,
// Trigger, Sequence, Foreign Table e Materialized View.
//
// A escolha é POR CONEXÃO, e não global, porque o mesmo servidor pesa diferente
// em cada uso: um banco onde ele mexe em gatilho quer a categoria; outro, onde
// ele só consulta, quer a árvore curta.
//
// Artigo III: quem declara o que é opcional é o DRIVER — só ele sabe que MySQL
// não tem foreign table. A tela recebe os campos prontos e obedece.
import type { FieldSpec, FieldValue } from '../contracts';

export interface CategoriaOpcional {
  /** O mesmo id da categoria na árvore. */
  readonly id: string;
  readonly label: string;
  /**
   * O que vale quando o cadastro não diz nada.
   *
   * É `true` nas categorias que JÁ apareciam antes desta spec: ligar um
   * interruptor não pode apagar da tela o que ele via ontem.
   */
  readonly padrao: boolean;
  readonly ajuda?: string;
}

/** A seção do formulário onde os interruptores moram, juntos. */
export const SECAO_DA_ARVORE = 'Árvore';

/** O nome do campo que guarda a escolha daquela categoria. */
export function nomeDoCampo(id: string): string {
  return `ver_${id}`;
}

/**
 * Lê a escolha, aceitando o `true` de verdade e o `'true'` de texto.
 *
 * A ida e a volta pelo JSON do cadastro transforma booleano em texto — está
 * escrito assim no contrato do `showIf`, e vale aqui pela mesma razão.
 */
function ligado(valor: FieldValue | undefined, padrao: boolean): boolean {
  if (valor === undefined || valor === '') return padrao;
  return valor === true || valor === 'true';
}

/** Os campos de formulário dos interruptores, na ordem em que foram declarados. */
export function camposDeVisibilidade(
  opcionais: readonly CategoriaOpcional[]
): readonly FieldSpec[] {
  return opcionais.map((c) => ({
    name: nomeDoCampo(c.id),
    label: `Mostrar ${c.label}`,
    type: 'boolean' as const,
    default: c.padrao,
    section: SECAO_DA_ARVORE,
    ...(c.ajuda === undefined ? {} : { help: c.ajuda }),
  }));
}

/**
 * Aquela categoria aparece?
 *
 * Categoria que NÃO está na lista de opcionais aparece sempre — é o caso de
 * Tables e Views, que não têm interruptor porque desligá-las esvaziaria a
 * árvore.
 */
export function categoriaVisivel(
  id: string,
  opcionais: readonly CategoriaOpcional[],
  fields: Readonly<Record<string, FieldValue>>
): boolean {
  const opcional = opcionais.find((c) => c.id === id);
  if (opcional === undefined) return true;
  return ligado(fields[nomeDoCampo(id)], opcional.padrao);
}

/** Peneira uma lista de categorias pelo cadastro. */
export function filtrarCategorias<T extends { readonly id: string }>(
  categorias: readonly T[],
  opcionais: readonly CategoriaOpcional[],
  fields: Readonly<Record<string, FieldValue>>
): readonly T[] {
  return categorias.filter((c) => categoriaVisivel(c.id, opcionais, fields));
}
