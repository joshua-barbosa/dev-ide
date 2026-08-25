// Ordenar a listagem remota por coluna (spec 055).
//
// Puro e testado porque ordenação é onde mora o "quase certo": comparar
// `null` como zero põe a pasta sem tamanho junto do arquivo vazio, e comparar
// texto sem `localeCompare` põe `Ácido` depois de `zebra`.

export type ColunaDeOrdem = 'nome' | 'tamanho' | 'modificado' | 'tipo' | 'dono';
export type Direcao = 'asc' | 'desc';

export interface Ordenavel {
  readonly name: string;
  readonly kind: 'file' | 'folder' | 'link';
  readonly size: number | null;
  readonly modifiedAt: number | null;
  readonly owner?: string;
}

/** Pasta antes de arquivo — em qualquer coluna, como no FileZilla. */
function peso(kind: Ordenavel['kind']): number {
  return kind === 'folder' ? 0 : 1;
}

function comparar(a: number | string, b: number | string): number {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'pt-BR');
  return Number(a) - Number(b);
}

function valorDe(e: Ordenavel, coluna: ColunaDeOrdem): number | string | null {
  switch (coluna) {
    case 'nome':
      return e.name;
    case 'tamanho':
      return e.size;
    case 'modificado':
      return e.modifiedAt;
    case 'tipo':
      return e.kind;
    case 'dono':
      return e.owner ?? null;
  }
}

export function ordenarPorColuna<T extends Ordenavel>(
  entradas: readonly T[],
  coluna: ColunaDeOrdem,
  direcao: Direcao
): readonly T[] {
  const sinal = direcao === 'asc' ? 1 : -1;
  return [...entradas].sort((a, b) => {
    // O agrupamento pasta/arquivo NÃO se inverte: inverter a ordem de uma
    // coluna não devia jogar as pastas para o fim da lista.
    const grupo = peso(a.kind) - peso(b.kind);
    if (grupo !== 0) return grupo;

    const va = valorDe(a, coluna);
    const vb = valorDe(b, coluna);

    // O que FALTA vai para o fim nas duas direções, e por isso a comparação de
    // ausência fica FORA do sinal. Multiplicá-la junto traria os desconhecidos
    // para a frente ao inverter a coluna — o que não se sabe não é "maior".
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;

    if (va !== null && vb !== null) {
      const principal = comparar(va, vb);
      if (principal !== 0) return principal * sinal;
    }
    // Empate desempata pelo NOME, sempre crescente: sem isto, duas ordenações
    // seguidas pela mesma coluna dariam listas diferentes.
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}
