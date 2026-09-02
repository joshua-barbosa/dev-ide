// Os terminais do painel de baixo: abrir, dividir e o comando inicial.
//
// Saiu do `App` quando ele estourou o teto de 800 do Artigo IV. O assunto é um
// só: **o painel de baixo**. O terminal de CONEXÃO é outro — ele é aba do
// editor, e mora em `useAbasDeDados` (decisão D6 da spec 031).
import { useCallback, useState } from 'react';
import {
  abrirTerminal as abrirNoPainel, dividirTerminal, normalizarTerminais, SEM_TERMINAIS,
  type EstadoDeTerminais,
} from '../../shared/terminais';
import { usePersistido } from '../usePersistido';
import type { AparenciaDoTerminal } from '../../shared/terminal/aparencia';

export interface TerminaisDoPainel {
  readonly terminais: EstadoDeTerminais;
  setTerminais: React.Dispatch<React.SetStateAction<EstadoDeTerminais>>;
  /**
   * O comando que cada terminal roda ao nascer.
   *
   * Existe porque o terminal só é criado no próximo render: guardar o comando
   * aqui e deixá-lo ser lido na montagem é o que faz `cd "pasta"` (T090) e as
   * tarefas do `tasks.json` (T015) funcionarem sem uma segunda rota.
   */
  readonly comandosIniciais: ReadonlyMap<string, string>;
  /** Abre um terminal de shell no painel, opcionalmente com um comando. */
  abrir(comando?: string): void;
  /** Abre um terminal AO LADO do ativo, no mesmo par. */
  dividir(orientacao?: 'horizontal' | 'vertical'): void;

  /**
   * O comando que cada pane deve rodar AGORA — o `id` faz o mesmo texto valer
   * duas vezes.
   *
   * Por PANE, e não um só: com quatro terminais lado a lado, um estado
   * compartilhado mandaria o comando para todos ao mesmo tempo.
   */
  readonly comandosDoPainel: ReadonlyMap<string, { readonly id: number; readonly texto: string }>;
  setComandosDoPainel: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, { readonly id: number; readonly texto: string }>>
  >;
  /** A aparência de cada pane do painel (T086). Vazia = herda tudo. */
  readonly aparenciasDoPainel: ReadonlyMap<string, AparenciaDoTerminal>;
  setAparenciasDoPainel: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, AparenciaDoTerminal>>
  >;
}

export function useTerminaisDoPainel(mostrarPainel: (qual: 'terminal') => void): TerminaisDoPainel {
  const [terminais, setTerminais] = usePersistido(
    'terminais',
    SEM_TERMINAIS,
    normalizarTerminais
  );
  const [comandosIniciais, setComandosIniciais] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const [comandosDoPainel, setComandosDoPainel] = useState<
    ReadonlyMap<string, { readonly id: number; readonly texto: string }>
  >(new Map());
  const [aparenciasDoPainel, setAparenciasDoPainel] = useState<
    ReadonlyMap<string, AparenciaDoTerminal>
  >(new Map());

  const abrir = useCallback(
    (comando?: string): void => {
      const id = `term-${crypto.randomUUID()}`;
      if (comando !== undefined) {
        setComandosIniciais((atual) => new Map(atual).set(id, comando));
      }
      setTerminais((atual) => abrirNoPainel(atual, id));
      mostrarPainel('terminal');
    },
    [mostrarPainel, setTerminais]
  );

  const dividir = useCallback(
    (orientacao: 'horizontal' | 'vertical' = 'horizontal'): void => {
      setTerminais((a) => dividirTerminal(a, `term-${crypto.randomUUID()}`, orientacao));
      mostrarPainel('terminal');
    },
    [mostrarPainel, setTerminais]
  );

  return {
    terminais, setTerminais, comandosIniciais, abrir, dividir,
    comandosDoPainel, setComandosDoPainel,
    aparenciasDoPainel, setAparenciasDoPainel,
  };
}
