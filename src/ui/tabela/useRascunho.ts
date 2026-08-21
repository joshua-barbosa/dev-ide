// O rascunho da grade: o que foi mexido e ainda não foi gravado (spec 044).
//
// Existe separado de `useTabela` porque são responsabilidades opostas: aquele
// LÊ do banco, este acumula o que vai ESCREVER. Misturá-los faria a página
// recarregar e o rascunho sumir junto, sem ninguém perceber.
//
// **Nada aqui toca no banco.** O rascunho é local até o usuário mandar gravar,
// e é essa distância que impede um clique errado numa célula de virar escrita.
import { useCallback, useMemo, useState } from 'react';
import type { CellValue, TableColumn } from '../../shared/contracts';

/** Chave de uma linha, serializada para servir de índice do rascunho. */
export type IdDeLinha = string;

export interface CelulaAlterada {
  readonly antes: CellValue;
  readonly depois: CellValue;
}

export interface LinhaNova {
  readonly id: string;
  readonly valores: Readonly<Record<string, CellValue>>;
}

export interface Rascunho {
  readonly alteracoes: ReadonlyMap<IdDeLinha, Readonly<Record<string, CelulaAlterada>>>;
  readonly remocoes: ReadonlySet<IdDeLinha>;
  readonly novas: readonly LinhaNova[];
  /** Quantas linhas o rascunho mexe, no total. */
  readonly quantidade: number;
  readonly vazio: boolean;

  alterar(linha: IdDeLinha, coluna: string, antes: CellValue, depois: CellValue): void;
  alternarRemocao(linha: IdDeLinha): void;
  acrescentarLinha(): void;
  alterarNova(id: string, coluna: string, valor: CellValue): void;
  descartarNova(id: string): void;
  descartar(): void;
  /** O valor a mostrar numa célula: o do rascunho, se houver. */
  valorDe(linha: IdDeLinha, coluna: string, original: CellValue): CellValue;
  mexida(linha: IdDeLinha, coluna: string): boolean;
}

/**
 * A chave de uma linha, como texto.
 *
 * Serializada em JSON e não concatenada: chave composta com um pedaço contendo
 * o separador colidiria com outra linha — e a IDE gravaria na errada.
 */
export function idDaLinha(
  colunas: readonly TableColumn[],
  valores: readonly CellValue[]
): IdDeLinha {
  const chave: Record<string, CellValue> = {};
  colunas.forEach((c, i) => {
    if (c.chave) chave[c.name] = valores[i] ?? null;
  });
  return JSON.stringify(chave);
}

export function chaveDoId(id: IdDeLinha): Readonly<Record<string, CellValue>> {
  return JSON.parse(id) as Record<string, CellValue>;
}

export function useRascunho(): Rascunho {
  const [alteracoes, setAlteracoes] = useState<
    ReadonlyMap<IdDeLinha, Readonly<Record<string, CelulaAlterada>>>
  >(new Map());
  const [remocoes, setRemocoes] = useState<ReadonlySet<IdDeLinha>>(new Set());
  const [novas, setNovas] = useState<readonly LinhaNova[]>([]);
  // Contador só para dar id às linhas novas. Um `useState` em vez de `useRef`
  // porque o valor entra dentro de outro `setState` — e ali um ref lido de
  // fora do ciclo daria o valor de antes.
  const [, setProxima] = useState(0);

  const alterar = useCallback(
    (linha: IdDeLinha, coluna: string, antes: CellValue, depois: CellValue) => {
      setAlteracoes((atual) => {
        const proximo = new Map(atual);
        const daLinha = { ...(proximo.get(linha) ?? {}) };

        // Voltar ao valor original APAGA a alteração, em vez de gravar
        // "mudou para o mesmo". Sem isto, desfazer à mão deixaria um UPDATE
        // inútil no rascunho — e um `WHERE` a mais para dar conflito à toa.
        if (depois === antes) delete daLinha[coluna];
        else daLinha[coluna] = { antes, depois };

        if (Object.keys(daLinha).length === 0) proximo.delete(linha);
        else proximo.set(linha, daLinha);
        return proximo;
      });
    },
    []
  );

  const alternarRemocao = useCallback((linha: IdDeLinha) => {
    setRemocoes((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(linha)) proximo.delete(linha);
      else proximo.add(linha);
      return proximo;
    });
  }, []);

  const acrescentarLinha = useCallback(() => {
    setProxima((n) => {
      setNovas((atual) => [...atual, { id: `nova-${n}`, valores: {} }]);
      return n + 1;
    });
  }, []);

  const alterarNova = useCallback((id: string, coluna: string, valor: CellValue) => {
    setNovas((atual) =>
      atual.map((l) => (l.id === id ? { ...l, valores: { ...l.valores, [coluna]: valor } } : l))
    );
  }, []);

  const descartarNova = useCallback((id: string) => {
    setNovas((atual) => atual.filter((l) => l.id !== id));
  }, []);

  const descartar = useCallback(() => {
    setAlteracoes(new Map());
    setRemocoes(new Set());
    setNovas([]);
  }, []);

  return useMemo(
    () => ({
      alteracoes,
      remocoes,
      novas,
      quantidade: alteracoes.size + remocoes.size + novas.length,
      vazio: alteracoes.size === 0 && remocoes.size === 0 && novas.length === 0,
      alterar,
      alternarRemocao,
      acrescentarLinha,
      alterarNova,
      descartarNova,
      descartar,
      // `?? original` NÃO serve aqui: um valor pendente `null` — pôr a célula
      // em NULL, que é metade do ponto desta spec — cairia de volta no valor
      // original, e a tela mostraria o antigo com a alteração no rascunho.
      // A existência da entrada é que decide, não o valor dela.
      valorDe: (linha, coluna, original) => {
        const alterada = alteracoes.get(linha)?.[coluna];
        return alterada === undefined ? original : alterada.depois;
      },
      mexida: (linha, coluna) => alteracoes.get(linha)?.[coluna] !== undefined,
    }),
    [
      acrescentarLinha, alterar, alterarNova, alteracoes, alternarRemocao,
      descartar, descartarNova, novas, remocoes,
    ]
  );
}
