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
  ehRepeticao, registrarProblema, type OrigemDoProblema, type Problema,
} from '../shared/painel';

export interface Problemas {
  readonly lista: readonly Problema[];
  registrar(origem: OrigemDoProblema, erro: unknown): void;
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

  return { lista, registrar, limpar: () => setLista([]) };
}
