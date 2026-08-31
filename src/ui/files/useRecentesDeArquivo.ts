// Os arquivos abertos recentemente, por pasta (T051, spec 073).
//
// É o que faz o `Ctrl+P` abrir já útil: a nota dele foi *"fuzzy por nome, com
// os recentes no topo"*, e sem uma lista de recentes o campo vazio só teria a
// ordem alfabética do disco para oferecer.
//
// **Por pasta**, e não global: os arquivos de um projeto não têm nada a ver com
// os de outro, e misturá-los poria `README.md` de três projetos no topo.
//
// No `localStorage` pelo mesmo critério da largura da lateral e da sessão de
// abas: é memória de tela, muda a cada clique, e um ida-e-volta ao servidor por
// arquivo aberto seria desproporcional.
import { useCallback } from 'react';
import { usePersistido } from '../usePersistido';

/** Quantos guardar por pasta. Além disso a lista deixa de ser "recentes". */
const TETO = 30;

type PorPasta = Record<string, string[]>;

/** Leitura tolerante: um valor estragado vale como ausente, e não quebra o F5. */
function normalizar(bruto: unknown): PorPasta {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const saida: PorPasta = {};
  for (const [pasta, lista] of Object.entries(bruto as Record<string, unknown>)) {
    if (!Array.isArray(lista)) continue;
    saida[pasta] = lista.filter((c): c is string => typeof c === 'string').slice(0, TETO);
  }
  return saida;
}

export interface RecentesDeArquivo {
  /** Caminhos absolutos, do mais recente para o mais antigo. */
  readonly lista: readonly string[];
  registrar(caminho: string): void;
}

export function useRecentesDeArquivo(pasta: string): RecentesDeArquivo {
  const [porPasta, definir] = usePersistido<PorPasta>('arquivos-recentes', {}, normalizar);

  const registrar = useCallback(
    (caminho: string) => {
      if (pasta === '' || caminho === '') return;
      definir((atual) => {
        const anterior = atual[pasta] ?? [];
        // Reabrir um arquivo o traz para a frente em vez de duplicá-lo: a lista
        // é de POSIÇÕES, não de eventos.
        const nova = [caminho, ...anterior.filter((c) => c !== caminho)].slice(0, TETO);
        return { ...atual, [pasta]: nova };
      });
    },
    [definir, pasta]
  );

  return { lista: porPasta[pasta] ?? [], registrar };
}
