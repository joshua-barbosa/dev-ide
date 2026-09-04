// Onde os filhos de uma pasta entram na árvore de arquivos.
//
// Saiu de dentro do hook `usePasta` porque era código sem teste no lugar mais
// caro possível: a comparação `caminho.startsWith(raiz + '/')` era falsa em
// toda subpasta do Windows, os filhos nunca chegavam, e o painel — que é
// declarativo, "aberta e sem filhos significa vai buscar" — pedia de novo, e de
// novo, sem parar (D223).
//
// Tipos ESTRUTURAIS de propósito: o `FileNode` da interface e o do servidor
// entram aqui sem tradutor, e este módulo não puxa nenhum dos dois.
import { dentroDe } from './caminho-local';
import type { Plataforma } from './plataforma';

export interface NoDaArvore {
  readonly path: string;
  readonly type: 'dir' | 'file';
  /** Ausente é "ainda não carregada"; vazia é "carregada e vazia". */
  readonly children?: readonly NoDaArvore[];
}

export interface RaizComArvore {
  readonly pasta: string;
  readonly arvore: readonly NoDaArvore[];
}

/**
 * A árvore com os filhos de `alvo` preenchidos.
 *
 * Imutável de ponta a ponta, e só o ramo que muda é recriado: os outros voltam
 * como os MESMOS objetos, que é o que evita o React redesenhar a árvore inteira
 * a cada pasta aberta.
 */
export function enxertar<T extends NoDaArvore>(
  nos: readonly T[],
  alvo: string,
  filhos: readonly T[],
  plataforma: Plataforma
): readonly T[] {
  return nos.map((no) => {
    if (no.path === alvo) return { ...no, children: filhos };
    // Só desce pelo ramo que contém o alvo.
    if (no.type !== 'dir' || no.children === undefined) return no;
    if (!dentroDe(no.path, alvo, plataforma)) return no;
    return { ...no, children: enxertar(no.children as readonly T[], alvo, filhos, plataforma) };
  });
}

/**
 * O enxerto na raiz certa, entre várias abertas (T004).
 *
 * A raiz é escolhida pelo prefixo mais LONGO: com `/r` e `/r/dentro` as duas
 * abertas, uma pasta de dentro não pode cair na de fora.
 *
 * **A raiz não é um nó da árvore: ela É a árvore.** Sem esse caso, recarregar a
 * própria pasta aberta não fazia nada — `enxertar` procurava um nó com aquele
 * caminho e não achava.
 */
export function enxertarNasRaizes<R extends RaizComArvore>(
  raizes: readonly R[],
  caminho: string,
  filhos: readonly NoDaArvore[],
  plataforma: Plataforma
): readonly R[] {
  const donas = raizes.filter(
    (r) => caminho === r.pasta || dentroDe(r.pasta, caminho, plataforma)
  );
  const dona = donas.reduce<R | null>(
    (a, b) => (a === null || b.pasta.length > a.pasta.length ? b : a),
    null
  );
  // Fora de todas: devolve o MESMO arranjo, para quem compara por identidade
  // não redesenhar à toa.
  if (dona === null) return raizes;

  return raizes.map((raiz) => {
    if (raiz.pasta !== dona.pasta) return raiz;
    return {
      ...raiz,
      arvore: caminho === raiz.pasta
        ? filhos
        : enxertar(raiz.arvore, caminho, filhos, plataforma),
    };
  });
}
