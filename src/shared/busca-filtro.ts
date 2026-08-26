// `include` e `exclude` na busca em arquivos (T031 · spec 027).
//
// Na spec 027 eu escrevi "entra quando doer" e deixei de fora. Ele resgatou da
// lista dos 114.
//
// **Reusa o compilador de glob do `.gitignore`.** Escrever um segundo daria
// dois vocabulários de padrão na mesma IDE: `src/**/*.ts` funcionando aqui e
// não ali, ou `*` atravessando `/` num lugar e não no outro. Duas gramáticas
// para a mesma coisa é o defeito, não a feature — e o do `.gitignore` já é o
// que o usuário conhece de trabalhar com git.
import { lerRegras, ignorado, type Regra } from './gitignore';

export interface FiltroDeArquivos {
  /** Só varre o que casar com um destes. Vazio = varre tudo. */
  readonly incluir: readonly Regra[];
  /** Nunca varre o que casar com um destes. Vale DEPOIS do `incluir`. */
  readonly excluir: readonly Regra[];
}

/** Um padrão por vírgula, como no VS Code — e espaço em volta não conta. */
export function lerPadroes(bruto: string): readonly string[] {
  return bruto
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

export function montarFiltro(incluir: string, excluir: string): FiltroDeArquivos {
  return {
    incluir: lerRegras(lerPadroes(incluir).join('\n')),
    excluir: lerRegras(lerPadroes(excluir).join('\n')),
  };
}

export const SEM_FILTRO: FiltroDeArquivos = { incluir: [], excluir: [] };

/**
 * Este arquivo entra na busca?
 *
 * `excluir` vence `incluir`: quem escreve os dois está dizendo "tudo isto,
 * MENOS aquilo". A ordem contrária tornaria o `exclude` inútil sempre que o
 * `include` fosse mais largo, que é o caso normal.
 */
export function passaNoFiltro(relativo: string, filtro: FiltroDeArquivos): boolean {
  if (filtro.excluir.length > 0 && ignorado(relativo, false, filtro.excluir)) return false;
  if (filtro.incluir.length === 0) return true;
  return ignorado(relativo, false, filtro.incluir);
}

/**
 * A pasta pode conter algo que interessa?
 *
 * Só o `exclude` corta pasta. Um `include` de `*.ts` não pode podar `src/`,
 * senão a varredura nunca chegaria aos `.ts` lá dentro — o `include` é sobre o
 * ARQUIVO, e só se sabe o nome dele no fim do caminho.
 */
export function pastaVaiSerVarrida(relativo: string, filtro: FiltroDeArquivos): boolean {
  if (filtro.excluir.length === 0) return true;
  return !ignorado(relativo, true, filtro.excluir);
}
