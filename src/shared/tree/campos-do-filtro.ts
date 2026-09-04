// Os campos do filtro da árvore, como DADO.
//
// Saíram de dentro do `DialogoDeFiltro` porque agora existem dois desenhos para
// a mesma pergunta: a caixa do editor (na IDE) e a lista em passos do VS Code.
// Duas listas divergiriam — e a que divergisse seria a que ele usa menos, então
// o defeito ficaria escondido.
import type { Criterio } from './filtro-da-arvore';

export interface CampoDoFiltro {
  readonly criterio: Criterio;
  readonly chave: 'nome' | 'dono' | 'tamanho' | 'desde';
  readonly rotulo: string;
  /** Exemplos, não instrução: mostram a forma aceita sem ocupar uma linha. */
  readonly dica: string;
}

export const CAMPOS_DO_FILTRO: readonly CampoDoFiltro[] = [
  { criterio: 'nome', chave: 'nome', rotulo: 'Nome', dica: 'alunos, tiraduvidas_%, %_2024' },
  { criterio: 'dono', chave: 'dono', rotulo: 'Dono', dica: 'postgres, ia_master' },
  { criterio: 'tamanho', chave: 'tamanho', rotulo: 'Maior que', dica: '10 MB, 1,5 GB, 512K' },
  { criterio: 'data', chave: 'desde', rotulo: 'Mexida desde', dica: '2026-01-15 ou 30d' },
];
