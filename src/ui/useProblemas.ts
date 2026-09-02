// A lista de problemas que alimenta a aba `Problems`.
//
// Existe porque o painel de hoje se chama "saída" e recebe **só** a execução de
// código: erro de driver, falha de conexão e ação de menu não passavam por ele.
// Era a observação que fez a aba nascer.
//
// A lógica de acumular (ordem, teto, repetição) mora em `shared/painel.ts`, onde
// é testada sem navegador; aqui fica só o estado do React.
import { useCallback, useRef, useState } from 'react';
import {
  ehRepeticao, MAX_PROBLEMAS, registrarProblema,
  type OrigemDoProblema, type Problema,
} from '../shared/painel';
import { lerSaida } from '../shared/problem-matcher';

export interface Problemas {
  readonly lista: readonly Problema[];
  registrar(origem: OrigemDoProblema, erro: unknown): void;
  /**
   * Registra os problemas que um comando cuspiu (T008).
   *
   * **Substitui os daquela origem**, e não acumula: rodar o build de novo
   * mostra o estado de AGORA, e somar as duas rodadas deixaria na aba erros que
   * já foram corrigidos — que é a pior coisa que uma lista de problemas pode
   * fazer.
   */
  registrarDaSaida(
    origem: OrigemDoProblema,
    saida: string,
    raiz: string,
    arquivoReal?: string
  ): number;
  limpar(): void;
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return typeof erro === 'string' ? erro : String(erro);
}

export function useProblemas(): Problemas {
  const [lista, setLista] = useState<readonly Problema[]>([]);
  const sequencia = useRef(0);

  const registrar = useCallback((origem: OrigemDoProblema, erro: unknown) => {
    const mensagem = mensagemDe(erro).trim();
    if (mensagem === '') return;
    setLista((atual) => {
      // O mesmo erro costuma chegar por dois caminhos — a chamada que falhou e
      // o diálogo que a mostrou. Um par idêntico não ensina nada.
      if (ehRepeticao(atual, origem, mensagem)) return atual;
      sequencia.current += 1;
      return registrarProblema(atual, {
        id: `problema-${sequencia.current}`,
        origem,
        mensagem,
        quando: new Date().toISOString(),
      });
    });
  }, []);

  /**
   * Registra os problemas que um comando cuspiu (T008).
   *
   * **Substitui os daquela origem**, e não acumula: rodar o build de novo
   * mostra o estado de AGORA, e somar as duas rodadas deixaria na aba erros já
   * corrigidos — a pior coisa que uma lista de problemas pode fazer.
   */
  const registrarDaSaida = useCallback(
    (origem: OrigemDoProblema, saida: string, raiz: string, arquivoReal?: string): number => {
      const achados = lerSaida(saida, raiz, arquivoReal);
      setLista((atual) => {
        // Saem os que ESTA origem tinha LIDO DA SAÍDA — e não os relatos
        // avulsos (`lugar` ausente), que vêm de outro caminho e têm a sua
        // própria regra de repetição. Apagá-los aqui esvaziaria a aba sempre
        // que o matcher não reconhecesse o formato da ferramenta.
        const deOutros = atual.filter((p) => p.origem !== origem || p.lugar === undefined);
        const novos: Problema[] = achados.map((a, i) => {
          sequencia.current += 1;
          return {
            id: `saida-${sequencia.current}-${i}`,
            origem,
            mensagem: a.codigo === undefined ? a.mensagem : `${a.codigo}: ${a.mensagem}`,
            quando: new Date().toISOString(),
            lugar: { caminho: a.caminho, linha: a.linha, coluna: a.coluna },
            severidade: a.severidade,
          };
        });
        return [...novos, ...deOutros].slice(0, MAX_PROBLEMAS);
      });
      return achados.length;
    },
    []
  );

  return { lista, registrar, registrarDaSaida, limpar: () => setLista([]) };
}
